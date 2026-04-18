# Dashboard Real-Time Updates, onError Reporting, and Daily Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cursor-party dashboard update in real time, harden presence-server error paths, and add a daily reconciliation loop that prunes stale entries by querying each tracked PresenceAgent directly.

**Architecture:** The singleton `DashboardServer` Durable Object keeps a `traffic` map. We change its value shape from `number` to `{ name, count }` so we can call `getAgentByName(PRESENCE_SERVER, name).getConnectionCount()` during reconciliation. Real-time push uses the Agents SDK's built-in WebSocket upgrade on `/dashboard` — `onConnect` sends the current state, and every state mutation triggers `this.broadcast()`. Daily reconciliation is scheduled in `onStart` via `scheduleEvery(86400, "reconcile")`, with the schedule id stored in state for idempotency.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects, Cloudflare Agents SDK (`agents` package v0.11.1), esbuild.

**Spec:** `docs/superpowers/specs/2026-04-17-dashboard-realtime-and-reconciliation-design.md`

**Testing note:** This repo has no test runner configured. Verification for each task uses `npx tsc --noEmit` (type-checking) and `npm run build:client` (bundle check), plus manual browser verification with `npm run dev` where relevant.

---

## File Structure

Changes are confined to two files; routing in `index.ts` already handles both HTTP and WebSocket on `/dashboard`.

- **`src/server.ts`** (modify): `PresenceAgent.reportToDashboard` passes `this.name`; new `@callable() getConnectionCount`; hardened `onError`.
- **`src/dashboard.ts`** (modify): `DashboardState` shape; `updateTraffic` signature + broadcast; `onConnect`; `onStart`; `reconcile`; SSR HTML + inline WS client script.
- **`src/index.ts`** (unchanged): `/dashboard` and `/dashboard/*` already forward to `dashboard.fetch(request)`; `Agent.fetch` handles WebSocket upgrades.

---

## Task 1: Change DashboardState shape and updateTraffic signature (coupled to PresenceAgent)

Because `updateTraffic`'s signature and the `PresenceAgent` caller must change together, this task edits both files in one commit.

**Files:**
- Modify: `src/dashboard.ts`
- Modify: `src/server.ts:146-156`

- [ ] **Step 1: Update DashboardState type and updateTraffic in `src/dashboard.ts`**

Replace the file's contents above `onRequest` (keep `onRequest` unchanged for now — it still renders the old shape and will be rewritten in Task 5):

```ts
import { Agent, callable } from "agents";
import type { Env } from "./index";

export const DASHBOARD_SINGLETON = "index";

type TrafficEntry = { name: string; count: number };
type DashboardState = {
  traffic: Record<string, TrafficEntry>;
  reconcileScheduleId?: string;
};

export default class DashboardServer extends Agent<Env, DashboardState> {
  static options = {
    hibernate: true,
  };

  initialState: DashboardState = { traffic: {} };

  shouldSendProtocolMessages(): boolean {
    return false;
  }

  @callable()
  updateTraffic(href: string, userCount: number, name: string) {
    const traffic = { ...this.state.traffic };
    if (userCount <= 0) {
      delete traffic[href];
    } else {
      traffic[href] = { name, count: userCount };
    }
    this.setState({ ...this.state, traffic });
  }
```

Leave `onRequest` and the closing `}` as they are for now. Task 5 will rewrite the HTML renderer to read the new shape.

- [ ] **Step 2: Update `reportToDashboard` in `src/server.ts:146-156` to pass `this.name`**

Replace the method body:

```ts
reportToDashboard() {
  const href = this.state?.href;
  if (!href) return;
  const count = [...this.getConnections()].length;
  getAgentByName<Env, DashboardServer>(
    this.env.DASHBOARD_SERVER,
    DASHBOARD_SINGLETON
  )
    .then((stub) => stub.updateTraffic(href, count, this.name))
    .catch((err) => console.error("Dashboard report failed:", err));
}
```

The change is adding `, this.name` as the third argument to `stub.updateTraffic(...)`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0 with no errors. The `onRequest` in `dashboard.ts` will produce no type error because `count` is read from `traffic[href]` after this task — wait: it still does. Read `onRequest` — line 34 reads `const traffic = this.state.traffic;` and line 38 uses `count` from `Object.entries(traffic)` where the value is now `TrafficEntry`, not `number`. This WILL produce a type error in the HTML template (`${count}`). That's fine — fix in Task 5. But tsc will fail here.

If tsc errors in `onRequest`, temporarily coerce the template to keep the build green until Task 5:

```ts
const rows = sorted
  .map(([href, entry]) => `<tr><td>${(entry as TrafficEntry).count}</td><td><a href="${href}">${href}</a></td></tr>`)
  .join("\n");
```

And change the sort to `.sort(([, a], [, b]) => (b as TrafficEntry).count - (a as TrafficEntry).count);`.

And the header:
```ts
<p>${sorted.length} active page${sorted.length !== 1 ? "s" : ""}, ${Object.values(traffic).reduce((sum, v) => sum + (v as TrafficEntry).count, 0)} total users</p>
```

Re-run `npx tsc --noEmit`. Expected: exits 0.

- [ ] **Step 4: Build client bundle to confirm esbuild is still happy**

Run: `npm run build:client`
Expected: builds `public/cursors.js` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.ts src/server.ts
git commit -m "feat(dashboard): track presence agent name per traffic entry"
```

---

## Task 2: Harden PresenceAgent onError to always report to dashboard

**Files:**
- Modify: `src/server.ts:207-213`

- [ ] **Step 1: Replace the `onError` implementation**

Replace lines 207–213 of `src/server.ts` with:

```ts
onError(connection: Connection, error: unknown): void;
onError(error: unknown): void;
onError(connectionOrError: Connection | unknown, error?: unknown) {
  console.error("PresenceAgent onError", error ?? connectionOrError);
  if (
    connectionOrError &&
    typeof connectionOrError === "object" &&
    "id" in (connectionOrError as Connection)
  ) {
    this.leave(connectionOrError as ConnectionWithUser);
  }
  this.reportToDashboard();
}
```

Two changes: (1) unconditional log at top; (2) `this.reportToDashboard()` moved out of the `if` so it runs on the global-error path too. Calling it after `leave()` (which already reports) is idempotent — the dashboard simply overwrites the count.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "fix(presence): always report to dashboard on error"
```

---

## Task 3: Add getConnectionCount callable to PresenceAgent

**Files:**
- Modify: `src/server.ts` (import list + add method)

- [ ] **Step 1: Import `callable` in `src/server.ts:1`**

Change line 1 from:

```ts
import { Agent, getAgentByName, type Connection, type ConnectionContext } from "agents";
```

to:

```ts
import { Agent, callable, getAgentByName, type Connection, type ConnectionContext } from "agents";
```

- [ ] **Step 2: Add the method inside the `PresenceAgent` class, after `reportToDashboard` (around line 156)**

Insert:

```ts
  @callable()
  getConnectionCount(): number {
    return [...this.getConnections()].length;
  }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(presence): add getConnectionCount callable"
```

---

## Task 4: Broadcast state changes and send snapshot on connect (DashboardServer)

**Files:**
- Modify: `src/dashboard.ts`

- [ ] **Step 1: Import `Connection` type**

Change the import line of `src/dashboard.ts` from:

```ts
import { Agent, callable } from "agents";
```

to:

```ts
import { Agent, callable, type Connection } from "agents";
```

- [ ] **Step 2: Add a private broadcast helper and an onConnect to the `DashboardServer` class**

Add these methods inside the class (below `shouldSendProtocolMessages`, above `updateTraffic`):

```ts
  private broadcastState() {
    this.broadcast(
      JSON.stringify({ type: "state", traffic: this.state.traffic })
    );
  }

  onConnect(connection: Connection) {
    connection.send(
      JSON.stringify({ type: "state", traffic: this.state.traffic })
    );
  }
```

- [ ] **Step 3: Call `broadcastState()` at the end of `updateTraffic`**

Replace the `updateTraffic` body with:

```ts
  @callable()
  updateTraffic(href: string, userCount: number, name: string) {
    const traffic = { ...this.state.traffic };
    if (userCount <= 0) {
      delete traffic[href];
    } else {
      traffic[href] = { name, count: userCount };
    }
    this.setState({ ...this.state, traffic });
    this.broadcastState();
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.ts
git commit -m "feat(dashboard): broadcast state to websocket viewers"
```

---

## Task 5: Rewrite dashboard HTML to new state shape + add `id="summary"`

**Files:**
- Modify: `src/dashboard.ts` (the `onRequest` method)

- [ ] **Step 1: Replace the `onRequest` method**

Replace the entire `onRequest` method with:

```ts
  async onRequest(req: Request) {
    if (req.method === "GET") {
      const traffic = this.state.traffic;
      const sorted = Object.entries(traffic).sort(
        ([, a], [, b]) => b.count - a.count
      );

      const rows = sorted
        .map(
          ([href, { count }]) =>
            `<tr><td>${count}</td><td><a href="${href}">${href}</a></td></tr>`
        )
        .join("\n");

      const totalUsers = Object.values(traffic).reduce(
        (sum, v) => sum + v.count,
        0
      );

      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Cursor Party Dashboard</title>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
    th:first-child, td:first-child { width: 80px; text-align: right; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>Cursor Party Dashboard</h1>
  <p id="summary">${sorted.length} active page${sorted.length !== 1 ? "s" : ""}, ${totalUsers} total users</p>
  <table>
    <thead><tr><th>Users</th><th>Page</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=\"2\">No active sessions</td></tr>"}</tbody>
  </table>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
```

Two changes vs. the current code: (a) values in `traffic` are destructured as `{ count }`; (b) the summary paragraph gains `id="summary"` so the inline script in Task 6 can target it.

If Task 1 Step 3 added temporary `(entry as TrafficEntry)` casts, they're overwritten by this step.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Manual check — start dev server and load the dashboard**

Run: `npm run dev`
Open: http://localhost:8787/dashboard

Expected: page loads with header, the summary line, and either "No active sessions" or any existing rows rendered as `<count> | <href>`. Stop the dev server (`Ctrl+C`) before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.ts
git commit -m "refactor(dashboard): render new traffic shape with summary id"
```

---

## Task 6: Add inline WebSocket client script to dashboard HTML

**Files:**
- Modify: `src/dashboard.ts` (the `onRequest` method — insert `<script>` before `</body>`)

- [ ] **Step 1: Add an inline script that opens a WS and re-renders on state messages**

In the HTML template string inside `onRequest`, insert the following `<script>` block immediately before `</body>`:

```html
<script>
(function() {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
    });
  }
  function render(traffic) {
    var entries = Object.entries(traffic).sort(function(a, b) {
      return b[1].count - a[1].count;
    });
    var total = entries.reduce(function(s, e) { return s + e[1].count; }, 0);
    var summary = document.getElementById("summary");
    if (summary) {
      summary.textContent = entries.length + " active page" +
        (entries.length !== 1 ? "s" : "") + ", " + total + " total users";
    }
    var tbody = document.querySelector("tbody");
    if (tbody) {
      if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2">No active sessions</td></tr>';
      } else {
        tbody.innerHTML = entries.map(function(e) {
          var href = e[0];
          var count = e[1].count;
          return '<tr><td>' + count + '</td><td><a href="' +
            escapeHtml(href) + '">' + escapeHtml(href) + '</a></td></tr>';
        }).join("");
      }
    }
  }
  var ws;
  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/dashboard");
    ws.onmessage = function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg && msg.type === "state") render(msg.traffic);
      } catch (_) {}
    };
    ws.onclose = function() { setTimeout(connect, 2000); };
    ws.onerror = function() { try { ws.close(); } catch (_) {} };
  }
  connect();
})();
</script>
```

Make sure it sits inside the template literal immediately before the `</body>` tag.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Manual check — real-time updates**

Run: `npm run dev`

Open two tabs:
1. http://localhost:8787/dashboard
2. http://localhost:8787/ (the welcome page — this triggers a PresenceAgent connection)

Expected: the dashboard tab's table adds the welcome-page row within ~1 second of tab 2 opening, with count `1`. Close tab 2 — within a second the row disappears (the PresenceAgent's `onClose` fires, reports 0, dashboard removes it, broadcast pushes the update).

Open DevTools in the dashboard tab, Network → WS. Expected: one WebSocket connection open to `/dashboard`; messages flowing on traffic changes.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.ts
git commit -m "feat(dashboard): live websocket client with auto-reconnect"
```

---

## Task 7: Daily reconciliation via scheduleEvery

**Files:**
- Modify: `src/dashboard.ts`

- [ ] **Step 1: Add imports at the top of `src/dashboard.ts`**

Change the imports block to:

```ts
import { Agent, callable, getAgentByName, type Connection } from "agents";
import type { Env } from "./index";
import type PresenceAgent from "./server";
```

- [ ] **Step 2: Add `onStart` to the `DashboardServer` class**

Add this method inside the class (below `onConnect`):

```ts
  async onStart() {
    const existingId = this.state.reconcileScheduleId;
    if (existingId) {
      const schedules = this.getSchedules();
      if (schedules.some((s) => s.id === existingId)) return;
    }
    const schedule = await this.scheduleEvery(86400, "reconcile");
    this.setState({ ...this.state, reconcileScheduleId: schedule.id });
  }
```

- [ ] **Step 3: Add the `reconcile` method below `onStart`**

```ts
  async reconcile() {
    const entries = Object.entries(this.state.traffic);
    const next: Record<string, TrafficEntry> = {};
    for (const [href, entry] of entries) {
      // Skip legacy-shape entries that lack a name
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.name !== "string"
      ) {
        continue;
      }
      const { name } = entry;
      try {
        const stub = await getAgentByName<Env, PresenceAgent>(
          this.env.PRESENCE_SERVER,
          name
        );
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

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

If the type-checker complains that `getSchedules()` or `scheduleEvery()` are missing from the `Agent` base class, upgrade `agents` or check the SDK version. Current lockfile is `agents@^0.11.1`, which exposes both.

- [ ] **Step 5: Manual check — force a reconcile to verify it runs**

Temporarily lower the interval to verify behavior (revert after). In `onStart`, change `86400` to `30` (seconds). Run:

```
npm run dev
```

Open http://localhost:8787/ in a tab and leave the dashboard open. Watch the `wrangler dev` console. Expected: every ~30s a reconcile runs (no errors, or per-entry logs if any lookup fails). Dashboard table should remain stable when the welcome page is open.

Now simulate a ghost: in a PresenceAgent, entries can linger if a close doesn't fire. For a deterministic smoke test instead: open welcome page → confirm dashboard shows `1` → close welcome tab → dashboard shows empty (normal onClose path). Reconcile's value is catching cases where onClose did NOT fire; that's harder to force locally, but the method runs without error.

**Revert `86400` back to the real value:**

```ts
const schedule = await this.scheduleEvery(86400, "reconcile");
```

Re-run `npx tsc --noEmit` to confirm no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.ts
git commit -m "feat(dashboard): daily reconciliation via scheduleEvery"
```

---

## Task 8: Final build + end-to-end smoke test

**Files:** none — verification only.

- [ ] **Step 1: Full type-check and build**

Run in order:
```
npx tsc --noEmit
npm run build:client
```
Expected: both exit 0.

- [ ] **Step 2: End-to-end smoke test**

Run: `npm run dev`

Checklist (all should pass):

1. `GET http://localhost:8787/dashboard` renders the table (empty or prior entries).
2. Opening http://localhost:8787/ in a new tab causes the dashboard to add a row with count `1` within ~1s (via WS broadcast).
3. Opening a second welcome-page tab updates the same row to count `2`.
4. Closing one of the two welcome tabs drops it to `1`.
5. Reloading the dashboard tab immediately shows the correct count (via SSR), then the WS reconnects without changing anything.
6. Killing the dev server and restarting: dashboard comes back up; reconcile is scheduled once (check `wrangler dev` logs — no stack of "duplicate schedule" issues).

Stop the dev server.

- [ ] **Step 3: Confirm no orphan commits or uncommitted files**

Run: `git status`
Expected: clean working tree.

---

## Done

At this point:
- Dashboard viewers see live updates via WebSocket.
- PresenceAgent reports on both error and close paths.
- Every 24h the dashboard self-corrects by querying each tracked PresenceAgent for its real connection count.
