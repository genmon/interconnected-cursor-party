# Dashboard Feature

## Summary

Add a DashboardServer singleton Durable Object that tracks per-URL user counts across all PresenceServer rooms. PresenceServer reports connection changes via DO RPC. The dashboard is accessible at `/dashboard` and pretty-prints a sorted list of URLs by user count.

## Components

### DashboardServer (`src/dashboard.ts`)

- New file, `extends Agent<Env, DashboardState>`
- Exported constant `DASHBOARD_SINGLETON = "index"`
- State type: `{ traffic: Record<string, number> }` with `initialState = { traffic: {} }`
- Persists across hibernation via Agent state
- `shouldSendProtocolMessages()` returns `false`
- Hibernation enabled

**RPC method:**
- `updateTraffic(href: string, userCount: number)`: sets `state.traffic[href] = userCount`, deletes the key if `userCount === 0`
- Decorated with `@callable()` for DO RPC access

**HTTP handler:**
- `onRequest`: reads `this.state.traffic`, sorts entries by count descending, returns pretty-printed HTML page

### PresenceServer changes (`src/server.ts`)

- In `onConnect`: read `from` query param from the WebSocket upgrade request URL, decode it. Store as `href` in Agent state (`this.setState({ href })`) if `this.state?.href` is not already set.
- State type added: `Agent<Env, { href?: string }>` — this is Agent-level state, separate from per-connection state
- New helper `reportToDashboard()`: counts connections via `[...this.getConnections()].length`, gets `href` from `this.state`, calls `getAgentByName(this.env.DASHBOARD_SERVER, DASHBOARD_SINGLETON)` then `stub.updateTraffic(href, count)`
- Call `reportToDashboard()` at end of `onConnect` (after `this.join()`) and at end of `leave()`
- Fire-and-forget: don't await the RPC, just `.catch(console.error)` — dashboard updates shouldn't block cursor updates

### Worker routing (`src/index.ts`)

- Add `/dashboard` path match before the 404 fallback
- Match: `url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")`
- Forward to `getAgentByName(env.DASHBOARD_SERVER, DASHBOARD_SINGLETON).fetch(request)`

### Config (`wrangler.jsonc`)

- Add `DASHBOARD_SERVER` DO binding with class `DashboardServer`
- Add migration tag `v2` with `new_sqlite_classes: ["DashboardServer"]`

### Env type (`src/index.ts`)

- Import `DashboardServer` from `./dashboard`
- Export `DashboardServer` alongside `PresenceServer`
- Add `DASHBOARD_SERVER: DurableObjectNamespace<DashboardServer>` to `Env` interface

## Files Changed

| File | Action |
|------|--------|
| `src/dashboard.ts` | Create |
| `src/server.ts` | Modify (add href state, reportToDashboard, call on connect/leave) |
| `src/index.ts` | Modify (add dashboard routing, update Env, export DashboardServer) |
| `wrangler.jsonc` | Modify (add binding + migration) |

## Verification

1. `npx tsc --noEmit` passes
2. `npm run dev` starts
3. Open `http://localhost:8787` in two tabs
4. Visit `http://localhost:8787/dashboard` — should show the localhost URL with user count 2
5. Close one tab, refresh dashboard — count drops to 1
