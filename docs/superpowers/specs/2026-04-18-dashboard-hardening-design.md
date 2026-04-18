# Dashboard Hardening: Correctness, Security, and Realtime UX

Follow-up to the realtime dashboard feature that shipped on 2026-04-17. Addresses subtle issues found in an audit: a race in daily reconciliation, a security hole exposing `updateTraffic` to external clients, SSR XSS via unescaped `href`, broadcast/render storms under high traffic, and mobile-viewport weaknesses.

## Context

After merging the realtime dashboard, a reliability audit flagged eight issues. The user triaged them:

- **Fix:** C1 (reconcile race), I1 (broadcast storm), I2 (client render storm), I7 (callable forgery + public WS inbound), I8 (SSR XSS + mobile responsiveness), minor onError double-report.
- **Skip:** I3 (WS protocol pings already exist), I4 (single-user dashboard), I5 (mobile tab freeze — can revisit if observed), I6 (not a real bug on re-read).

One PR.

## Changes

### 1. C1 — `reconcile` race (`src/dashboard.ts`)

Cloudflare DO input gates only protect during *storage* awaits. RPC awaits (like `stub.getConnectionCount()`) let queued inbound calls interleave and observe inconsistent state. `reconcile` reads `state.traffic`, awaits N RPCs, then writes `next` — updates arriving during those awaits are queued behind reconcile, fire after it, but reconcile has already written its stale snapshot.

Fix: fan out all RPCs with `Promise.all` *before* touching state; then apply inside `blockConcurrencyWhile` so the read-and-write is atomic with respect to other handlers.

```ts
async reconcile() {
  const entries = Object.entries(this.state.traffic).filter(
    ([, entry]) => entry && typeof entry === "object" && typeof entry.name === "string"
  );
  const results = await Promise.all(
    entries.map(async ([href, { name }]) => {
      try {
        const stub = await getAgentByName<Env, PresenceAgent>(this.env.PRESENCE_SERVER, name);
        return { href, name, count: await stub.getConnectionCount() };
      } catch (err) {
        console.error(`Reconcile failed for ${href} (${name}):`, err);
        return { href, name, count: 0 };
      }
    })
  );
  await this.ctx.blockConcurrencyWhile(async () => {
    const next: Record<string, TrafficEntry> = {};
    for (const { href, name, count } of results) {
      if (count > 0) next[href] = { name, count };
    }
    this.setState({ ...this.state, traffic: next });
  });
  this.broadcastState();
}
```

### 2. I7 — lock down `DashboardServer` (`src/dashboard.ts`)

- Remove `@callable()` from `updateTraffic`. It's called only server-to-server via `stub.updateTraffic(...)` from `PresenceAgent`. The decorator exposes it via the Agents SDK client RPC protocol; external browsers could forge entries.
- Override `onMessage` to close inbound WS messages. Dashboard viewers only *receive* state; they never send.

```ts
onMessage(connection: Connection) {
  connection.close(1003, "Dashboard is read-only");
}
```

### 3. I8 — SSR escaping + URL allowlist (`src/dashboard.ts`)

SSR interpolates `${href}` into both `<a href="..."` and link text with no escaping. A malformed PresenceAgent value could inject HTML. Also, `javascript:` URLs aren't blocked anywhere.

```ts
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
function safeHref(href: string): string {
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "#";
  } catch { return "#"; }
  return href;
}
```

Apply in the SSR row template:
```ts
const safe = escapeHtml(safeHref(href));
`<tr><td>${count}</td><td><a href="${safe}">${escapeHtml(href)}</a></td></tr>`
```

### 4. I1 — broadcast throttle (`src/dashboard.ts`)

`broadcastState()` fires on every `updateTraffic` call. Reuse the `scheduleBroadcast` / `_broadcast` pattern from `PresenceAgent` at a slower cap (250ms = 4Hz). State updates remain immediate; only network fan-out is coalesced.

```ts
private lastBroadcast = 0;
private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
private static BROADCAST_INTERVAL = 250; // 4Hz

private broadcastState() {
  const now = Date.now();
  const ago = now - this.lastBroadcast;
  if (ago >= DashboardServer.BROADCAST_INTERVAL) {
    this._broadcast();
  } else if (!this.broadcastTimer) {
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this._broadcast();
    }, DashboardServer.BROADCAST_INTERVAL - ago);
  }
}

private _broadcast() {
  this.lastBroadcast = Date.now();
  this.broadcast(JSON.stringify({ type: "state", traffic: this.state.traffic }));
}
```

`onConnect` continues to send the snapshot directly (bypassing the throttle).

### 5. I2 — client rAF coalesce (`src/dashboard.ts` inline JS)

Replace `ws.onmessage` to write the latest traffic into a shared variable and render at most once per animation frame.

```js
var pendingTraffic = null;
var rafPending = false;
ws.onmessage = function(ev) {
  try {
    var msg = JSON.parse(ev.data);
    if (msg && msg.type === "state") {
      pendingTraffic = msg.traffic;
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(function() {
          rafPending = false;
          if (pendingTraffic) render(pendingTraffic);
          pendingTraffic = null;
        });
      }
    }
  } catch (_) {}
};
```

### 6. I8 continuation — responsive mobile CSS (`src/dashboard.ts`)

Add `<meta name="viewport" ...>` and make the table readable on narrow screens.

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
  th:first-child, td:first-child { width: 80px; text-align: right; }
  a { color: #0066cc; word-break: break-all; }
  @media (max-width: 600px) {
    body { margin: 20px auto; padding: 0 12px; }
    th, td { padding: 6px 8px; }
    th:first-child, td:first-child { width: 56px; }
  }
</style>
```

### 7. onError tidy (`src/server.ts`)

Current code calls `reportToDashboard()` from both `leave()` (inside the if) and unconditionally at the end. One per call is enough:

```ts
onError(connectionOrError: Connection | unknown, error?: unknown) {
  console.error("PresenceAgent onError", error ?? connectionOrError);
  if (connectionOrError && typeof connectionOrError === "object" && "id" in connectionOrError) {
    this.leave(connectionOrError as ConnectionWithUser); // reports
  } else {
    this.reportToDashboard(); // global-error path only
  }
}
```

## Non-goals

- I3 (heartbeat): WebSocket protocol pings + Cloudflare idle-close handle dead-peer detection.
- I4 (backoff jitter): dashboard has a single viewer.
- I5 (visibility/bfcache reconnect): defer until mobile use is observed.
- I6 (state.href latch): retry happens automatically on next connect.

## Testing

- `npx tsc --noEmit` and `npm run build:client` green.
- `curl /dashboard` returns HTML with `meta viewport`, escape helpers applied, no `@callable()` exposed.
- Manual browser smoke (controller): dashboard still updates in real time; mobile view looks reasonable.
