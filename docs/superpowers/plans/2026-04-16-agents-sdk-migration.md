# Agents SDK Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate cursor-party from PartyServer to Cloudflare Agents SDK, convert wrangler config to JSONC, and clean up legacy PartyKit naming.

**Architecture:** Replace `Server` from `partyserver` with `Agent` from `agents`. Use manual routing in the Worker fetch handler to preserve the existing `/parties/presence-server/{room-id}` WebSocket URL that cached client scripts depend on. Suppress Agents SDK protocol frames via `shouldSendProtocolMessages`. Client code (`partysocket`, msgpack protocol) is unchanged.

**Tech Stack:** Cloudflare Workers, Agents SDK (`agents` ^0.11.x), Wrangler 4.x, Preact, partysocket, msgpack, Zod, Zustand

**Spec:** `docs/superpowers/specs/2026-04-16-agents-sdk-migration-design.md`

---

### Task 1: Update dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Swap partyserver for agents and update wrangler**

In `package.json`, replace the `partyserver` dependency with `agents`, and update `wrangler` to latest:

```json
"dependencies": {
    "@msgpack/msgpack": "^3.0.0-beta2",
    "@preact/compat": "^17.1.2",
    "@types/rangy": "^0.0.38",
    "agents": "^0.11.1",
    "partysocket": "0.0.17",
    "zod": "^3.25.76",
    "zustand": "^4.4.7"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20251213.0",
    "@types/react": "^18.2.42",
    "@types/react-dom": "^18.2.17",
    "dotenv": "^16.3.1",
    "esbuild": "^0.27.1",
    "typescript": "^5.3.3",
    "wrangler": "^4.83.0"
  }
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: Clean install, no errors. `agents` package appears in `node_modules`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: swap partyserver for agents SDK, update wrangler"
```

---

### Task 2: Convert wrangler.toml to wrangler.jsonc

**Files:**
- Delete: `wrangler.toml`
- Create: `wrangler.jsonc`

- [ ] **Step 1: Create wrangler.jsonc**

Create `wrangler.jsonc` with the following content. Key changes from the TOML: `new_classes` becomes `new_sqlite_classes` (required by Agents SDK), `$schema` added for editor validation, `compatibility_date` updated to `2025-09-01`.

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "cursor-party",
  "main": "src/index.ts",
  "compatibility_date": "2025-09-01",

  // Durable Objects configuration
  "durable_objects": {
    "bindings": [
      {
        "name": "PRESENCE_SERVER",
        "class_name": "PresenceServer",
        "script_name": "cursor-party"
      }
    ]
  },

  // Durable Objects migrations
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["PresenceServer"]
    }
  ],

  // Static assets configuration
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  },

  // Environment variables
  "vars": {
    "WEBSITES": "[\"https://cursor-party.genmon.workers.dev/*\", \"https://(www.)?interconnected.org/*\"]"
  },

  // Observability
  "observability": {
    "enabled": true
  }
}
```

- [ ] **Step 2: Delete wrangler.toml**

```bash
rm wrangler.toml
```

- [ ] **Step 3: Validate config**

Run: `npx wrangler check`
Expected: No validation errors.

- [ ] **Step 4: Commit**

```bash
git add wrangler.jsonc
git rm wrangler.toml
git commit -m "chore: convert wrangler.toml to wrangler.jsonc with Agents SDK migrations"
```

---

### Task 3: Migrate server to Agents SDK

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Update import**

Replace line 1:

```typescript
// Old:
import { Server, type Connection, type ConnectionContext } from "partyserver";

// New:
import { Agent, type Connection, type ConnectionContext } from "agents";
```

- [ ] **Step 2: Update class declaration and add shouldSendProtocolMessages**

Replace the class declaration (line 30) and add `shouldSendProtocolMessages` right after `static options`:

```typescript
// Old:
export default class PresenceServer extends Server {
  static options = {
    hibernate: true,
  };

// New:
export default class PresenceServer extends Agent<Env> {
  static options = {
    hibernate: true,
  };

  // Suppress CF_AGENT_* protocol frames — clients use msgpack, not the Agents SDK protocol
  shouldSendProtocolMessages(): boolean {
    return false;
  }
```

No other changes to method bodies. The lifecycle hooks (`onConnect`, `onMessage`, `onClose`, `onError`), `connection.setState`, `this.getConnections()`, `this.broadcast()`, and `this.name` all have identical APIs between PartyServer and the Agents SDK.

- [ ] **Step 3: Add Env import**

Add the Env type import at the top of the file (after the agents import):

```typescript
import type { Env } from "./index";
```

Note: This creates a circular reference (`index.ts` imports from `server.ts`, `server.ts` imports from `index.ts`). This is fine because the import is `type`-only — it's erased at compile time by both TypeScript and esbuild/wrangler.

- [ ] **Step 4: Verify build**

Run: `npm run build:client`
Expected: Build succeeds (this only builds the client, but validates no TypeScript import issues in the shared schema).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: migrate PresenceServer from partyserver Server to agents Agent"
```

---

### Task 4: Migrate Worker routing

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite src/index.ts**

Replace the entire contents of `src/index.ts` with:

```typescript
import { getAgentByName } from "agents";
import PresenceServer from "./server";

// Export the Durable Object class
export { PresenceServer };

// Define the Env interface for TypeScript
export interface Env extends Record<string, unknown> {
  PRESENCE_SERVER: DurableObjectNamespace<PresenceServer>;
  WEBSITES: string;
  ASSETS: Fetcher;
}

// Website allowlist validation
function onBeforeConnect(req: Request, env: Env): Response | null {
  // we assume that the request url is encoded into the request query param
  const encodedHomeURL = new URL(req.url).searchParams.get("from");

  if (!encodedHomeURL) {
    return new Response("Not Allowed", { status: 403 });
  }

  const homeURL = new URL(decodeURIComponent(encodedHomeURL));

  const WEBSITES = JSON.parse(env.WEBSITES || "[]") as string[];

  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(homeURL.hostname)) {
    return null;
  }

  const matchWith = homeURL.origin + homeURL.pathname;

  const patterns = WEBSITES.map((site) => {
    try {
      return new URLPattern(site);
    } catch (e) {
      console.log(
        `

⚠️  Invalid URL pattern "${site}" in WEBSITES environment variable.
It should be a valid input to new URLPattern().
Learn more: https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API

`
      );
      throw e;
    }
  });

  const allowed = patterns.some((pattern) => pattern.test(matchWith));
  if (!allowed) {
    const errMessage = `The URL ${matchWith} does not match any allowed pattern from ${env.WEBSITES}`;
    const pair = new WebSocketPair();
    pair[1].accept();
    pair[1].close(1011, errMessage || "Uncaught exception when connecting");
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
    });
  }

  return null;
}

// Worker fetch handler
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Match the legacy PartyServer URL convention: /parties/presence-server/{room-id}
    // Preserved for backwards compatibility with cached client scripts
    const match = url.pathname.match(
      /^\/parties\/presence-server\/(.+?)(?:\/|$)/
    );

    if (match) {
      const roomId = match[1];

      // Run website allowlist validation for WebSocket upgrades
      if (request.headers.get("Upgrade") === "websocket") {
        const rejection = onBeforeConnect(request, env);
        if (rejection) return rejection;
      }

      // Forward to the Agent instance
      const agent = await getAgentByName<PresenceServer>(
        env.PRESENCE_SERVER,
        roomId
      );
      return agent.fetch(request);
    }

    // Non-party requests: fall through to static assets
    // Cloudflare Workers will automatically serve from the assets directory
    // configured in wrangler.jsonc
    return new Response("Not found", { status: 404 });
  },
};
```

Key changes from the original:
- `routePartykitRequest` replaced with manual URL parsing + `getAgentByName`
- `onBeforeConnect` returns `Response | null` instead of `Response | Request`
- For localhost, returns `null` (allow) instead of `req` (the original returned the request to signal "allow")
- The regex preserves the exact `/parties/presence-server/{room-id}` path

- [ ] **Step 2: Verify dev server starts**

Run: `npm run dev`
Expected: Wrangler starts without errors, serves on `http://localhost:8787`. Press Ctrl+C to stop after verifying startup.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: replace routePartykitRequest with manual routing via getAgentByName"
```

---

### Task 5: Rename PARTYKIT_HOST to WORKER_HOST

**Files:**
- Modify: `scripts/build-client.mjs`
- Modify: `src/cursors.tsx`

- [ ] **Step 1: Update build script**

In `scripts/build-client.mjs`, rename all occurrences of `PARTYKIT_HOST` to `WORKER_HOST`. The full updated file:

```javascript
import * as esbuild from "esbuild";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load environment variables
dotenv.config();

// Determine the WORKER_HOST based on environment
const isDev = process.env.NODE_ENV !== "production";

let WORKER_HOST;
if (isDev) {
  // For local dev, use window.location.host so the welcome page works
  WORKER_HOST = "window.location.host";
} else {
  // For production, REQUIRE the WORKER_HOST env var
  // This is critical because the script will be embedded on other domains
  if (!process.env.WORKER_HOST) {
    console.error("");
    console.error("❌ ERROR: WORKER_HOST environment variable is required for production builds!");
    console.error("");
    console.error("The script will be embedded on other websites (e.g., interconnected.org)");
    console.error("and needs to know which worker to connect to.");
    console.error("");
    console.error("Set it in your .env file:");
    console.error('  WORKER_HOST=cursor-party.YOUR-ACCOUNT.workers.dev');
    console.error("");
    console.error("Or pass it as an environment variable:");
    console.error('  WORKER_HOST=cursor-party.YOUR-ACCOUNT.workers.dev npm run deploy');
    console.error("");
    process.exit(1);
  }
  WORKER_HOST = JSON.stringify(process.env.WORKER_HOST);
}

console.log("🎈 Building Cursor Party client...");
console.log(`📡 Mode: ${isDev ? "development" : "production"}`);
console.log(`📡 WORKER_HOST: ${WORKER_HOST}`);

// Step 1: Run the splash script (generate meta.js)
if (process.env.WEBSITES) {
  fs.writeFileSync(
    "public/meta.js",
    `window.__WEBSITES__ = ${JSON.stringify(process.env.WEBSITES)};`
  );
  console.log("✓ Generated public/meta.js");
}

// Step 2: Bundle the client code
try {
  await esbuild.build({
    entryPoints: ["src/cursors.tsx"],
    bundle: true,
    outfile: "public/cursors.js",
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: process.env.NODE_ENV === "production",
    sourcemap: true,
    splitting: false,
    // Alias React to Preact for smaller bundle size
    alias: {
      react: "@preact/compat",
      "react-dom": "@preact/compat",
    },
    // Define WORKER_HOST as a global constant
    // In dev mode, this will be the actual expression window.location.host
    // In production, it will be a string literal
    define: {
      WORKER_HOST: WORKER_HOST,
    },
    logLevel: "info",
  });

  console.log("✓ Built public/cursors.js");
  console.log("🎉 Client build complete!");
} catch (error) {
  console.error("❌ Build failed:", error);
  process.exit(1);
}
```

- [ ] **Step 2: Update client entry point**

In `src/cursors.tsx`, change line 6 and line 15:

```typescript
// Old:
declare const PARTYKIT_HOST: string;

// New:
declare const WORKER_HOST: string;
```

```typescript
// Old:
      host={PARTYKIT_HOST}

// New:
      host={WORKER_HOST}
```

- [ ] **Step 3: Verify client build**

Run: `npm run build:client`
Expected: Build succeeds, `public/cursors.js` is generated.

- [ ] **Step 4: Update .env file if it exists**

If `.env` exists, rename `PARTYKIT_HOST` to `WORKER_HOST`. Example:

```env
WORKER_HOST=cursor-party.genmon.workers.dev
```

- [ ] **Step 5: Commit**

```bash
git add scripts/build-client.mjs src/cursors.tsx
git commit -m "refactor: rename PARTYKIT_HOST to WORKER_HOST"
```

---

### Task 6: Full verification

- [ ] **Step 1: Clean install and build**

```bash
rm -rf node_modules
npm install
npm run build:client
```

Expected: All succeed without errors.

- [ ] **Step 2: Start dev server and test**

```bash
npm run dev
```

Expected:
- Wrangler starts on `http://localhost:8787`
- Welcome page loads in browser
- Open two browser tabs to `http://localhost:8787` — cursors appear and track across tabs
- Type `/` to open chat — chat works
- In browser DevTools WebSocket inspector: no `CF_AGENT_IDENTITY`, `CF_AGENT_STATE`, or `CF_AGENT_MCP_SERVERS` text frames — only binary (msgpack) frames

- [ ] **Step 3: Commit verification note (optional)**

No code changes — this is a manual verification step.

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Make the following changes throughout `CLAUDE.md`:

1. **Project Overview** (near top): Change "PartyServer (Durable Objects)" to "Cloudflare Agents SDK (Durable Objects)" and update the description of the backend:
   - "**Backend**: PartyServer Durable Object (`src/server.ts`)" → "**Backend**: Agents SDK Durable Object (`src/server.ts`)"

2. **Cloudflare Workers Configuration**: Update bullet about the Durable Object:
   - "**Durable Object**: `PresenceServer` class in `src/server.ts`" stays the same
   - Update mention of environment variables to reference `wrangler.jsonc` instead of `wrangler.toml`

3. **Build Process**: 
   - Replace all `PARTYKIT_HOST` references with `WORKER_HOST`
   - Update `.env` example to use `WORKER_HOST`

4. **Client Embedding**: Update the WebSocket URL comment to note it uses legacy PartyServer path format preserved for compatibility.

5. **Replace "Key API Differences from PartyKit" section** (lines 189-215) with:

```markdown
## Agents SDK Notes

This project uses the Cloudflare Agents SDK (`agents` package). Key details:

### Server Class
- Extends `Agent<Env>` from `agents`
- Lifecycle hooks: `onConnect`, `onMessage`, `onClose`, `onError` (same signatures as PartyServer)
- `connection.setState()`, `this.getConnections()`, `this.broadcast()`, `this.name` — standard Agent APIs
- `shouldSendProtocolMessages()` returns `false` to suppress `CF_AGENT_*` protocol frames (clients use msgpack)

### Routing
- The Worker entry point (`src/index.ts`) uses manual URL parsing + `getAgentByName` instead of `routeAgentRequest`
- This preserves the legacy `/parties/presence-server/{room-id}` URL path for backwards compatibility with cached client scripts
- Website allowlist validation runs in the Worker fetch handler before forwarding to the Agent

### Configuration
- `wrangler.jsonc` (not TOML) with `$schema` for editor validation
- Durable Object migration uses `new_sqlite_classes` (required by Agents SDK)
- Hibernation enabled via `static options = { hibernate: true }`
```

6. **All other references**: Replace `wrangler.toml` with `wrangler.jsonc` throughout. Replace `PARTYKIT_HOST` with `WORKER_HOST` throughout.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Agents SDK migration"
```

---

### Task 8: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README.md**

1. **Line 12**: Replace the PartyKit demo link:
   ```markdown
   // Old:
   👉 See a demo: [here's the Cursor Party deployment](https://cursor-party.labs.partykit.dev) behind the multiplayer cursors on the [PartyKit blog](https://blog.partykit.io).

   // New:
   👉 See it in action on [interconnected.org](https://interconnected.org).
   ```

2. **Line 59**: Update config reference:
   ```markdown
   // Old:
   For local development, create a `.dev.vars` file. For production, you'll set environment variables in wrangler.toml.

   // New:
   For local development, create a `.dev.vars` file. For production, you'll set environment variables in wrangler.jsonc.
   ```

3. **Line 78**: Update wrangler.toml reference:
   ```markdown
   // Old:
   (If you do this then remove vars from `wrangler.toml` to avoid conflicts.)

   // New:
   (If you do this then remove vars from `wrangler.jsonc` to avoid conflicts.)
   ```

4. **Line 124**: Update wrangler.toml reference in customization section:
   ```markdown
   // Old:
   Edit `wrangler.toml` and change the `name` field to customize your Worker's URL.

   // New:
   Edit `wrangler.jsonc` and change the `name` field to customize your Worker's URL.
   ```

5. Update any `.env` references from `PARTYKIT_HOST` to `WORKER_HOST` if present (check the file — currently README doesn't reference `PARTYKIT_HOST` directly, so this may not apply).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README.md for Agents SDK migration"
```
