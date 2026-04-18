# Dashboard Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix C1 race in reconcile, lock down `DashboardServer` from external RPC/WS forgery, escape SSR HTML, throttle broadcast/render storms, tidy `onError`, and make the dashboard mobile-readable — one PR.

**Architecture:** All changes in `src/dashboard.ts` (state/broadcast/SSR/HTML) plus a tiny `onError` tidy in `src/server.ts`. No routing or schema changes.

**Tech Stack:** Cloudflare Agents SDK (`agents` ^0.11.1), Durable Objects, TypeScript, esbuild.

**Spec:** `docs/superpowers/specs/2026-04-18-dashboard-hardening-design.md`

**Verification:** `npx tsc --noEmit` + `npm run build:client` after every task. No test harness in this repo.

---

## File Structure

- `src/dashboard.ts` (modify): state-apply atomicity, remove `@callable()`, add `onMessage` drop, add `escapeHtml`/`safeHref`, throttled `broadcastState`, inline JS rAF coalescer, viewport + mobile CSS.
- `src/server.ts` (modify): `onError` if/else tidy.
- `src/index.ts` (unchanged).

---

## Task 1: Fix C1 — atomic reconcile with Promise.all + blockConcurrencyWhile

**Files:**
- Modify: `src/dashboard.ts` (the `reconcile` method)

- [ ] **Step 1: Replace the `reconcile` method body**

Current `reconcile()` does sequential awaits and then setState. Replace with fan-out + atomic apply:

```ts
  async reconcile() {
    const entries = Object.entries(this.state.traffic).filter(
      ([, entry]) =>
        entry && typeof entry === "object" && typeof entry.name === "string"
    );
    const results = await Promise.all(
      entries.map(async ([href, { name }]) => {
        try {
          const stub = await getAgentByName<Env, PresenceAgent>(
            this.env.PRESENCE_SERVER,
            name
          );
          const count = await stub.getConnectionCount();
          return { href, name, count };
        } catch (err) {
          // Drop on error: reconcile's purpose is to clear stale entries.
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

Rationale comment (one line) can be added above `blockConcurrencyWhile`:
```ts
    // Atomic apply: input gates don't cover RPC awaits, so this prevents queued updateTraffic from being clobbered.
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build:client`
Expected: tsc exit 0; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard.ts
git commit -m "fix(dashboard): atomic reconcile to prevent race with updateTraffic"
```

---

## Task 2: I7 — lock down DashboardServer from external clients

**Files:**
- Modify: `src/dashboard.ts`

- [ ] **Step 1: Remove `@callable()` from `updateTraffic`**

Find the method:
```ts
  @callable()
  updateTraffic(href: string, userCount: number, name: string) {
```

Change to:
```ts
  updateTraffic(href: string, userCount: number, name: string) {
```

If the `callable` import is no longer used anywhere else in the file after this change, remove it from the top-level import:
```ts
import { Agent, getAgentByName, type Connection } from "agents";
```
(Before: `import { Agent, callable, getAgentByName, type Connection } from "agents";`)

- [ ] **Step 2: Add `onMessage` handler that drops inbound messages**

Place it next to `onConnect` in the class:
```ts
  onMessage(connection: Connection) {
    // Dashboard is receive-only; reject anything a client sends.
    connection.close(1003, "Dashboard is read-only");
  }
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit && npm run build:client`
Expected: tsc exit 0; build succeeds.

If tsc errors that `updateTraffic` is missing `@callable()` when invoked via `stub.updateTraffic(...)` in `src/server.ts`, STOP and report — that would mean the Agents SDK needs the decorator for server-to-server RPC, not just client RPC. In that case we'll need a different approach (e.g. a stored secret, or routing-level auth).

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.ts
git commit -m "fix(dashboard): make DashboardServer receive-only for external clients"
```

---

## Task 3: I8 — server-side escapeHtml + safeHref + responsive CSS

**Files:**
- Modify: `src/dashboard.ts` (file-level helpers + `onRequest` HTML)

- [ ] **Step 1: Add helpers at module scope (above the class)**

After the `DashboardState` type, before the class:
```ts
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function safeHref(href: string): string {
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "#";
  } catch {
    return "#";
  }
  return href;
}
```

- [ ] **Step 2: Apply helpers in the SSR row template**

Change the `rows` builder inside `onRequest`:
```ts
      const rows = sorted
        .map(([href, { count }]) => {
          const safe = escapeHtml(safeHref(href));
          const text = escapeHtml(href);
          return `<tr><td>${count}</td><td><a href="${safe}">${text}</a></td></tr>`;
        })
        .join("\n");
```

- [ ] **Step 3: Add viewport meta and responsive CSS**

In the HTML template, change the `<head>` contents to:
```html
<head>
  <title>Cursor Party Dashboard</title>
  <meta charset="utf-8">
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
</head>
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit && npm run build:client`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.ts
git commit -m "fix(dashboard): escape SSR HTML, allowlist URL scheme, responsive layout"
```

---

## Task 4: I1 — throttled broadcast (4Hz cap)

**Files:**
- Modify: `src/dashboard.ts`

- [ ] **Step 1: Replace `broadcastState` with throttled pattern**

Remove the current one-liner `private broadcastState()` that calls `this.broadcast(...)`. Replace with:

```ts
  private static BROADCAST_INTERVAL = 250; // 4Hz cap
  private lastBroadcast = 0;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  private broadcastState() {
    const now = Date.now();
    const ago = now - this.lastBroadcast;
    if (ago >= DashboardServer.BROADCAST_INTERVAL) {
      this._doBroadcast();
    } else if (!this.broadcastTimer) {
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null;
        this._doBroadcast();
      }, DashboardServer.BROADCAST_INTERVAL - ago);
    }
  }

  private _doBroadcast() {
    this.lastBroadcast = Date.now();
    this.broadcast(
      JSON.stringify({ type: "state", traffic: this.state.traffic })
    );
  }
```

`onConnect` continues to call `connection.send(...)` directly — new viewers bypass the throttle and get the latest snapshot immediately.

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build:client`

- [ ] **Step 3: Commit**

```bash
git add src/dashboard.ts
git commit -m "perf(dashboard): throttle broadcast to 4Hz to coalesce update storms"
```

---

## Task 5: I2 — client rAF coalesce

**Files:**
- Modify: `src/dashboard.ts` (inline `<script>` inside the HTML template)

- [ ] **Step 1: Replace `ws.onmessage` in the inline JS**

Current:
```js
    ws.onmessage = function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg && msg.type === "state") render(msg.traffic);
      } catch (_) {}
    };
```

Replace with (keeping the IIFE / `var` / ES5 style):
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

The `pendingTraffic` + `rafPending` vars live in the `connect()` closure — declare them inside `connect()` before assigning `ws.onmessage`.

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build:client`

- [ ] **Step 3: Commit**

```bash
git add src/dashboard.ts
git commit -m "perf(dashboard): rAF coalesce client rendering of state updates"
```

---

## Task 6: onError tidy (`src/server.ts`)

**Files:**
- Modify: `src/server.ts` (the `onError` method)

- [ ] **Step 1: Replace `onError` body**

Current:
```ts
  onError(connectionOrError: Connection | unknown, error?: unknown) {
    console.error("PresenceAgent onError", error ?? connectionOrError);
    if (connectionOrError && typeof connectionOrError === "object" && "id" in (connectionOrError as Connection)) {
      this.leave(connectionOrError as ConnectionWithUser);
    }
    this.reportToDashboard();
  }
```

Replace with (exactly one report per call):
```ts
  onError(connectionOrError: Connection | unknown, error?: unknown) {
    console.error("PresenceAgent onError", error ?? connectionOrError);
    if (connectionOrError && typeof connectionOrError === "object" && "id" in (connectionOrError as Connection)) {
      // leave() already calls reportToDashboard()
      this.leave(connectionOrError as ConnectionWithUser);
    } else {
      this.reportToDashboard();
    }
  }
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build:client`

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "refactor(presence): onError reports exactly once per call"
```

---

## Task 7: Final smoke + PR

- [ ] **Step 1: `npx tsc --noEmit && npm run build:client`** — both green.
- [ ] **Step 2: Quick `npm run dev` + `curl http://localhost:8787/dashboard`** — verify HTML contains `meta viewport`, has a `<style>` with `@media`, and the `<script>` block still renders without syntax errors. Stop dev server.
- [ ] **Step 3: Push + PR.**
