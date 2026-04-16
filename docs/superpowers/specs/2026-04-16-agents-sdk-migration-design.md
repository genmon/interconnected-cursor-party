# Migration: PartyServer to Cloudflare Agents SDK + wrangler.jsonc

## Summary

Migrate cursor-party from PartyServer (`partyserver` package) to the Cloudflare Agents SDK (`agents` package), and convert `wrangler.toml` to `wrangler.jsonc`. The client code (`usePartySocket`, msgpack protocol) remains unchanged.

## Motivation

PartyServer is being superseded by the Agents SDK as the standard way to build Durable Object-based real-time applications on Cloudflare Workers. The Agents SDK provides the same WebSocket lifecycle hooks with additional capabilities (SQLite state, callable RPC, scheduling). Wrangler now prefers JSONC config, and newer features are JSON-only.

## Constraints

- **Preserve `/parties/presence-server/{room-id}` URL path**: The client script (`cursors.js`) is embedded on external websites and cached by browsers. Changing the WebSocket URL would break existing cached clients.
- **Keep `partysocket` on the client**: No changes to `presence-context.tsx` or any client-side code.
- **Suppress Agents SDK protocol messages**: The Agent class sends `CF_AGENT_IDENTITY`, `CF_AGENT_STATE`, and `CF_AGENT_MCP_SERVERS` text frames on connect. These would confuse the existing msgpack-based client. Use `shouldSendProtocolMessages()` returning `false`.

## Changes

### 1. `wrangler.toml` -> `wrangler.jsonc`

Delete `wrangler.toml`. Create `wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "cursor-party",
  "main": "src/index.ts",
  "compatibility_date": "2024-11-30",
  "durable_objects": {
    "bindings": [
      {
        "name": "PRESENCE_SERVER",
        "class_name": "PresenceServer",
        "script_name": "cursor-party"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["PresenceServer"]
    }
  ],
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  },
  "vars": {
    "WEBSITES": "[\"https://cursor-party.genmon.workers.dev/*\", \"https://(www.)?interconnected.org/*\"]"
  },
  "observability": {
    "enabled": true
  }
}
```

Key differences from the TOML:
- `new_classes` -> `new_sqlite_classes` (required by Agents SDK)
- Added `$schema` for editor validation
- No data to preserve, so single migration tag is fine

### 2. `src/server.ts`

Replace `Server` from `partyserver` with `Agent` from `agents`:

```typescript
import { Agent, type Connection, type ConnectionContext } from "agents";
```

Class declaration:

```typescript
export default class PresenceServer extends Agent<Env> {
  static options = { hibernate: true };

  shouldSendProtocolMessages(connection: Connection, ctx: ConnectionContext): boolean {
    return false;
  }

  // ... rest of the class unchanged
}
```

Method signatures are identical between PartyServer and Agents SDK:
- `onConnect(connection, ctx)` - same
- `onMessage(connection, message)` - same  
- `onClose(connection, code, reason, wasClean)` - same
- `onError(connection, error)` - same
- `connection.setState()` - same
- `this.getConnections()` - same
- `this.broadcast()` - same
- `this.name` - same

The `ConnectionWithUser` type alias and all method bodies remain unchanged.

### 3. `src/index.ts`

Replace `routePartykitRequest` with manual routing using `getAgentByName`:

```typescript
import { getAgentByName } from "agents";
import PresenceServer from "./server";

export { PresenceServer };

export interface Env extends Record<string, unknown> {
  PRESENCE_SERVER: DurableObjectNamespace<PresenceServer>;
  WEBSITES: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Match the PartyServer URL convention: /parties/presence-server/{room-id}
    const match = url.pathname.match(/^\/parties\/presence-server\/(.+?)(?:\/|$)/);

    if (match) {
      const roomId = match[1];

      // Run onBeforeConnect validation for WebSocket upgrades
      if (request.headers.get("Upgrade") === "websocket") {
        const rejection = onBeforeConnect(request, env);
        if (rejection instanceof Response) return rejection;
      }

      // Forward to the Agent instance
      const agent = await getAgentByName(env.PRESENCE_SERVER, roomId);
      return agent.fetch(request);
    }

    // Non-party requests: fall through to static assets
    return new Response("Not found", { status: 404 });
  },
};
```

The `onBeforeConnect` function stays the same but returns `Response | null` instead of `Response | Request`:

```typescript
function onBeforeConnect(req: Request, env: Env): Response | null {
  // Same allowlist logic as before
  // Return Response to reject, null to allow
}
```

### 4. `package.json`

```diff
- "partyserver": "^0.0.75",
+ "agents": "^0.0.x",  (latest)
```

Update wrangler:
```diff
- "wrangler": "^4.54.0",
+ "wrangler": "^4.x",  (latest)
```

Keep `partysocket` unchanged.

### 5. `CLAUDE.md`

- Update "Project Overview" to reference Agents SDK instead of PartyServer
- Update import references (`partyserver` -> `agents`, `Server` -> `Agent`)
- Update routing description (manual routing preserving `/parties/...` path)
- Replace "Key API Differences from PartyKit" section with brief Agents SDK notes
- Update `Env` type to show `DurableObjectNamespace<PresenceServer>`

## Files Changed

| File | Action |
|------|--------|
| `wrangler.toml` | Delete |
| `wrangler.jsonc` | Create |
| `src/server.ts` | Edit (import + class declaration + shouldSendProtocolMessages) |
| `src/index.ts` | Edit (routing logic) |
| `src/cursors.tsx` | Edit (rename PARTYKIT_HOST -> WORKER_HOST) |
| `scripts/build-client.mjs` | Edit (rename PARTYKIT_HOST -> WORKER_HOST) |
| `package.json` | Edit (swap partyserver -> agents, update wrangler) |
| `CLAUDE.md` | Edit (update references throughout) |
| `README.md` | Edit (update PartyKit references) |

### 6. `tsconfig.json`

Update `compatibility_date` is only in wrangler config (already handled). But the tsconfig should be reviewed:
- Current config is fine for the Agents SDK — no changes needed
- `experimentalDecorators` is NOT needed since we don't use `@callable()` decorators

### 7. Update `compatibility_date`

Update from `2024-11-30` to a recent date (e.g. `2025-09-01`) in `wrangler.jsonc` to pick up latest Workers runtime features.

### 8. Rename `PARTYKIT_HOST` references

The build-time constant `PARTYKIT_HOST` is a legacy name. Rename to `WORKER_HOST` across:
- `scripts/build-client.mjs` — the define constant and env var check
- `src/cursors.tsx` — the `declare const` and usage
- `.env` file reference in CLAUDE.md and README
- CLAUDE.md documentation

This is purely cosmetic but reduces confusion now that we're on the Agents SDK.

### 9. `README.md`

Update references:
- Remove PartyKit blog/demo link (line 12) or update to current
- Update any mentions of PartyKit to Cloudflare Workers / Agents SDK

## Files NOT Changed

- `src/presence/presence-context.tsx` - client code unchanged (still uses `partysocket`)
- `src/presence/presence-schema.ts` - message protocol unchanged
- All other `src/presence/*.tsx` files - unchanged
- `tsconfig.json` - no changes needed

## Verification

1. `npm install` succeeds
2. `npm run build:client` succeeds
3. `npm run dev` starts without errors
4. Open `http://localhost:8787` - welcome page loads
5. Open two browser tabs - cursors appear and track across tabs
6. Chat (`/` key) works
7. No `CF_AGENT_*` protocol frames visible in WebSocket inspector
