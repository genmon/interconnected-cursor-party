# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard that shows real-time per-URL user counts across all cursor-party rooms.

**Architecture:** A singleton DashboardServer DO stores `{ traffic: Record<string, number> }` in Agent state. Each PresenceServer room reports its connection count + URL via DO RPC on connect/disconnect. The Worker routes `/dashboard` to the singleton's `onRequest`.

**Tech Stack:** Cloudflare Agents SDK, DO RPC via `@callable()` decorator

**Spec:** `docs/superpowers/specs/2026-04-16-dashboard-design.md`

---

### Task 1: Create DashboardServer

**Files:**
- Create: `src/dashboard.ts`

- [ ] **Step 1: Create src/dashboard.ts**

```typescript
import { Agent, callable } from "agents";
import type { Env } from "./index";

export const DASHBOARD_SINGLETON = "index";

type DashboardState = {
  traffic: Record<string, number>;
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
  updateTraffic(href: string, userCount: number) {
    const traffic = { ...this.state.traffic };
    if (userCount <= 0) {
      delete traffic[href];
    } else {
      traffic[href] = userCount;
    }
    this.setState({ ...this.state, traffic });
  }

  async onRequest(req: Request) {
    if (req.method === "GET") {
      const traffic = this.state.traffic;
      const sorted = Object.entries(traffic).sort(([, a], [, b]) => b - a);

      const rows = sorted
        .map(([href, count]) => `<tr><td>${count}</td><td><a href="${href}">${href}</a></td></tr>`)
        .join("\n");

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
  <p>${sorted.length} active page${sorted.length !== 1 ? "s" : ""}, ${Object.values(traffic).reduce((a, b) => a + b, 0)} total users</p>
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
}
```

- [ ] **Step 2: Commit**

```bash
git add src/dashboard.ts
git commit -m "feat: add DashboardServer DO for tracking per-URL user counts"
```

---

### Task 2: Add DashboardServer to wrangler config and Env

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `src/index.ts`

- [ ] **Step 1: Add DashboardServer binding to wrangler.jsonc**

Add a second binding to the `durable_objects.bindings` array:

```jsonc
      {
        "name": "DASHBOARD_SERVER",
        "class_name": "DashboardServer",
        "script_name": "cursor-party"
      }
```

Add a second migration entry to the `migrations` array:

```jsonc
    {
      "tag": "v2",
      "new_sqlite_classes": ["DashboardServer"]
    }
```

- [ ] **Step 2: Update Env and exports in src/index.ts**

Add import at top:

```typescript
import DashboardServer from "./dashboard";
import { DASHBOARD_SINGLETON } from "./dashboard";
```

Add to exports:

```typescript
export { PresenceServer, DashboardServer };
```

(Replace the existing `export { PresenceServer };` line.)

Add to Env interface:

```typescript
  DASHBOARD_SERVER: DurableObjectNamespace<DashboardServer>;
```

- [ ] **Step 3: Add /dashboard routing in the Worker fetch handler**

Add this block in the fetch handler, before the final `return new Response("Not found", { status: 404 });`:

```typescript
    // Dashboard route
    if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) {
      const dashboard = await getAgentByName<Env, DashboardServer>(
        env.DASHBOARD_SERVER,
        DASHBOARD_SINGLETON
      );
      return dashboard.fetch(request);
    }
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc src/index.ts
git commit -m "feat: register DashboardServer in wrangler config and Worker routing"
```

---

### Task 3: Wire PresenceServer to report to DashboardServer

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add state type and imports**

Update the class declaration to include state:

```typescript
// Old:
export default class PresenceServer extends Agent<Env> {

// New:
export default class PresenceServer extends Agent<Env, { href?: string }> {
```

Add import at top of file:

```typescript
import { getAgentByName } from "agents";
import { DASHBOARD_SINGLETON } from "./dashboard";
import type DashboardServer from "./dashboard";
```

- [ ] **Step 2: Store href in onConnect**

In the `onConnect` method, after the existing `const params = ...` line and before `connection.setState(...)`, add:

```typescript
    // Store the page URL in Agent state (not connection state) for dashboard reporting
    const from = params.get("from");
    if (from && !this.state?.href) {
      try {
        const href = decodeURIComponent(from);
        this.setState({ href });
      } catch {
        // ignore malformed URLs
      }
    }
```

- [ ] **Step 3: Add reportToDashboard helper**

Add this method to the PresenceServer class, after the `leave` method:

```typescript
  reportToDashboard() {
    const href = this.state?.href;
    if (!href) return;
    const count = [...this.getConnections()].length;
    getAgentByName<Env, DashboardServer>(
      this.env.DASHBOARD_SERVER,
      DASHBOARD_SINGLETON
    )
      .then((stub) => stub.updateTraffic(href, count))
      .catch((err) => console.error("Dashboard report failed:", err));
  }
```

- [ ] **Step 4: Call reportToDashboard on connect and leave**

In `onConnect`, add at the very end (after `this.join(connection);`):

```typescript
    this.reportToDashboard();
```

In `leave`, add after `this.scheduleBroadcast()...`:

```typescript
    this.reportToDashboard();
```

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat: report connection counts to DashboardServer on connect/disconnect"
```

---

### Task 4: Verify

- [ ] **Step 1: Build and start dev server**

```bash
npm run build:client && npm run dev
```

Expected: Wrangler starts without errors.

- [ ] **Step 2: Test dashboard**

1. Open `http://localhost:8787` in two browser tabs
2. Visit `http://localhost:8787/dashboard`
3. Should show 1 active page with 2 users (the localhost URL)
4. Close one tab, refresh dashboard — count drops to 1
5. Close both tabs, refresh dashboard — page should disappear from list
