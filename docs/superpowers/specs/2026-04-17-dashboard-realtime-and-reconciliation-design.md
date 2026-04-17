# Dashboard Real-Time Updates, onError Reporting, and Daily Reconciliation

## Context

The dashboard at `/dashboard` currently shows per-page visitor counts that are reported by each `PresenceAgent` via a singleton `DashboardServer` Durable Object. Two problems:

1. The dashboard is SSR-only and only reflects traffic as of the page request; there is no live update when counts change.
2. Many entries show "1 visitor" even when the page is idle, suggesting `onClose` isn't firing reliably on ungraceful disconnects, leaving the dashboard's `traffic` map with stale counts.

## Goals

- Push dashboard state changes to open viewers in real time.
- Make presence-server error paths report current counts, not just close paths.
- Reconcile dashboard state once per day against the ground-truth connection counts on each tracked `PresenceAgent`, dropping entries whose agent now has zero connections.

## Non-goals

- Rewriting the dashboard as a React/Preact app.
- Graceful migration of existing legacy state shape (acceptable to let old entries be overwritten or cleaned up by the next reconcile).

## Design

### State shape

`DashboardState` in `src/dashboard.ts`:

```ts
type TrafficEntry = { name: string; count: number };
type DashboardState = {
  traffic: Record<string, TrafficEntry>;
  reconcileScheduleId?: string;
};
```

- Key remains `href` (the page URL — the display identity).
- `name` is the `PresenceAgent`'s `this.name` (the base64-encoded room-id). Needed so reconciliation can call `getAgentByName(env.PRESENCE_SERVER, name)`.
- `reconcileScheduleId` is the id returned by `scheduleEvery`; stored so `onStart` can avoid creating duplicate schedules across hibernations or re-deploys.

### PresenceAgent changes (`src/server.ts`)

1. `reportToDashboard()` passes `this.name`:
   ```ts
   stub.updateTraffic(href, count, this.name)
   ```

2. New callable to support reconciliation:
   ```ts
   @callable()
   getConnectionCount(): number {
     return [...this.getConnections()].length;
   }
   ```

3. `onError` hardened to always report to the dashboard:
   ```ts
   onError(connectionOrError: Connection | unknown, error?: unknown) {
     console.error("PresenceAgent onError", error ?? connectionOrError);
     if (connectionOrError && typeof connectionOrError === "object" && "id" in connectionOrError) {
       this.leave(connectionOrError as ConnectionWithUser);
     }
     this.reportToDashboard();
   }
   ```
   `reportToDashboard()` is idempotent (the dashboard just overwrites the count for that `href`), so calling it after `leave()` — which also reports — is harmless but guarantees a report on the global-error path too.

### DashboardServer changes (`src/dashboard.ts`)

1. `updateTraffic` takes `name` and broadcasts after each write:
   ```ts
   @callable()
   updateTraffic(href: string, userCount: number, name: string) {
     const traffic = { ...this.state.traffic };
     if (userCount <= 0) delete traffic[href];
     else traffic[href] = { name, count: userCount };
     this.setState({ ...this.state, traffic });
     this.broadcastState();
   }

   private broadcastState() {
     this.broadcast(JSON.stringify({ type: "state", traffic: this.state.traffic }));
   }
   ```

2. `onConnect` sends the current state to new viewers so the page self-corrects if the initial SSR was stale:
   ```ts
   onConnect(connection: Connection) {
     connection.send(JSON.stringify({ type: "state", traffic: this.state.traffic }));
   }
   ```

3. `onStart` schedules daily reconciliation, idempotent across restarts:
   ```ts
   async onStart() {
     if (this.state.reconcileScheduleId) {
       const exists = this.getSchedules().some(s => s.id === this.state.reconcileScheduleId);
       if (exists) return;
     }
     const schedule = await this.scheduleEvery(86400, "reconcile");
     this.setState({ ...this.state, reconcileScheduleId: schedule.id });
   }
   ```

4. `reconcile` is the scheduled callback:
   ```ts
   async reconcile() {
     const entries = Object.entries(this.state.traffic);
     const next: Record<string, TrafficEntry> = {};
     for (const [href, entry] of entries) {
       // Defensively skip any legacy-shape entries that lack a name
       if (!entry || typeof entry !== "object" || typeof entry.name !== "string") continue;
       const { name } = entry;
       try {
         const stub = await getAgentByName<Env, PresenceAgent>(this.env.PRESENCE_SERVER, name);
         const count = await stub.getConnectionCount();
         if (count > 0) next[href] = { name, count };
       } catch (err) {
         console.error(`Reconcile failed for ${href} (${name}):`, err);
       }
     }
     this.setState({ ...this.state, traffic: next });
     this.broadcastState();
   }
   ```
   Entries whose agent reports zero, throws, is unreachable, or is legacy-shape are dropped.

### Dashboard HTML (`src/dashboard.ts` — the GET response)

Keep SSR for first paint. Append a small inline `<script>` that:

- Opens `ws[s]://<location.host>/dashboard`. The Agents SDK handles WebSocket upgrades inside `Agent.fetch()`, and `index.ts` already forwards `/dashboard` and `/dashboard/*` to `dashboard.fetch(request)`, so no routing changes are needed.
- Listens for `{ type: "state", traffic }` messages and re-renders the `<tbody>` and the header count line.
- Reconnects on close with a small backoff.

Approximate client snippet:

```html
<script>
(function() {
  function render(traffic) {
    const entries = Object.entries(traffic).sort(([, a], [, b]) => b.count - a.count);
    document.querySelector("#summary").textContent =
      `${entries.length} active page${entries.length !== 1 ? "s" : ""}, ` +
      `${entries.reduce((sum, [, v]) => sum + v.count, 0)} total users`;
    const tbody = document.querySelector("tbody");
    tbody.innerHTML = entries.length
      ? entries.map(([href, { count }]) =>
          `<tr><td>${count}</td><td><a href="${href}">${href}</a></td></tr>`
        ).join("")
      : `<tr><td colspan="2">No active sessions</td></tr>`;
  }
  let ws;
  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/dashboard`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "state") render(msg.traffic);
      } catch {}
    };
    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();
})();
</script>
```

The SSR HTML is adjusted so the header paragraph has `id="summary"` (for easy replacement) and uses the new `{name, count}` shape.

### Worker routing (`src/index.ts`)

No changes. `/dashboard` and `/dashboard/*` already forward to `dashboard.fetch(request)`, which handles both HTTP GET and WebSocket upgrades via the Agents SDK base class.

## Error handling

- Dashboard WS disconnects: client auto-reconnects after 2s.
- Reconcile failures per entry: caught and logged; entry is dropped.
- `onError` in `PresenceAgent`: logged; always reports current count to dashboard.

## Testing

Manual (no test harness exists in this repo):

1. `npm run dev`, open `/dashboard` in two tabs; open the welcome page in a third tab; verify both dashboard tabs update in real time as the welcome-page tab opens/closes.
2. `npm run build:client` to verify TypeScript compiles.
3. Simulate a stuck ghost: open welcome page, kill the tab via forced tab-close in dev tools "Close network" + kill process, confirm presence agent still shows the connection, then trigger `reconcile` manually (temporarily lower `scheduleEvery` or call the method in a debug route) and confirm the ghost entry is removed.

## Rollout

One deploy. No data migration; legacy `Record<string, number>` entries will be overwritten as live agents report in, or cleared on first reconciliation run (errors drop them).
