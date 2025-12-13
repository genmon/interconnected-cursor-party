# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cursor Party is a multiplayer cursor tracking system built on Cloudflare Workers with PartyServer (Durable Objects). It allows any website to add real-time collaborative cursors by including a single script tag. The project consists of:

- **Backend**: PartyServer Durable Object (`src/server.ts`) that manages WebSocket connections and broadcasts cursor positions
- **Worker Entry Point**: Cloudflare Worker (`src/index.ts`) that routes requests using `routePartykitRequest`
- **Frontend**: React/Preact client (`src/cursors.tsx`) that runs embedded in target websites via a script tag

## Development Commands

```bash
# Build client bundle only
npm run build:client

# Local development (builds client + starts wrangler dev)
npm run dev
# Server runs on http://localhost:8787

# Deploy to Cloudflare Workers (builds client + deploys)
npm run deploy

# Deploy preview (remote Cloudflare environment)
npm run preview

# Authenticate with Cloudflare (one-time setup)
npx wrangler login

# Set production environment variables
wrangler secret put WEBSITES
# Then paste your JSON array when prompted
```

### Local Development Environment

Local development uses `.dev.vars` for environment variables (gitignored). Create this file with:

```env
WEBSITES=["http://localhost:*/*", "http://127.0.0.1:*/*", "https://your-site.com/*"]
```

## Architecture

### Cloudflare Workers Configuration

`wrangler.toml` defines the Worker structure:
- **Worker entry point**: `src/index.ts` - Routes requests with `routePartykitRequest()`
- **Durable Object**: `PresenceServer` class in `src/server.ts`
- **Static assets**: Served from `public/` directory (configured in `wrangler.toml`)
- **Environment variables**: `WEBSITES` allowlist (set via `.dev.vars` locally or Cloudflare dashboard for production)

### Build Process

Client bundling is handled separately by `scripts/build-client.mjs`:
- Bundles `src/cursors.tsx` → `public/cursors.js` (IIFE format)
- Uses esbuild for bundling
- Aliases React to `@preact/compat` for smaller bundle size
- Defines `PARTYKIT_HOST` global constant:
  - **Development**: Set to `window.location.host` (auto-detects from browser when testing welcome page)
  - **Production**: **REQUIRES** `PARTYKIT_HOST` env var in `.env` file (hardcoded into bundle)
- Runs `scripts/splash-script.mjs` to generate `public/meta.js`
- Minifies in production (`NODE_ENV=production`)

The build runs automatically before `wrangler dev` and `wrangler deploy`.

**Critical for Production**: The `PARTYKIT_HOST` environment variable **must** be set in your `.env` file for production builds. This is because:
- The script will be embedded on other domains (e.g., `interconnected.org`)
- It needs to know which worker to connect back to (e.g., `cursor-party.genmon.workers.dev`)
- Using `window.location.host` would try to connect to the embedding site instead of the worker

Example `.env`:
```env
PARTYKIT_HOST=cursor-party.YOUR-ACCOUNT.workers.dev
WEBSITES=["https://cursor-party.YOUR-ACCOUNT.workers.dev/*", "https://(www.)?your-site.com/*"]
```

### Message Flow

The system uses **msgpack** for efficient binary serialization of all WebSocket messages:

1. **Client → Server** (`ClientMessage`):
   - `type: "update"` - Updates user's cursor position, name, color, chat message, or text selection

2. **Server → Client** (`PartyMessage`):
   - `type: "sync"` - Initial state with all connected users (sent on connection)
   - `type: "changes"` - Delta updates (add/update/remove users) broadcast at 60fps

### State Management

- **Zustand store** (`presence-context.tsx`): Manages local state including:
  - `myself` - Current user with optimistic updates
  - `otherUsers` - Map of other connected users
  - `pendingUpdate` - Queued presence updates to send to server

- **Durable Object state** (`server.ts`):
  - Queues updates and broadcasts deltas at 60fps to avoid overwhelming clients
  - Uses hibernation mode for cost optimization (automatically pauses when idle)
  - Stores connection state using Cloudflare Durable Objects

### Presence Schema

The `Presence` type (user-modifiable) includes:
- `name`, `color` - User identity
- `cursor` - `{x, y, pointer: "mouse"|"touch"}` position
- `message` - Chat message (secret feature activated by typing `/`)
- `selection` - Text selection for highlights
- `spotlightColor` - Color for text highlights

The `Metadata` type (server-set, read-only) includes:
- `country` - Determined from Cloudflare headers

### Security: Website Allowlist

The `WEBSITES` environment variable contains a JSON array of URL patterns (using URLPattern API). Only matching websites can connect to prevent abuse:

**Local development** (`.dev.vars`):
```env
WEBSITES=["http://localhost:*/*", "https://your-site.com/*"]
```

**Production** (set via Cloudflare dashboard or `wrangler secret put WEBSITES`):
```json
["https://cursor-party.YOUR-WORKER.workers.dev/*", "https://(www.)?example.org/*"]
```

The Worker's `onBeforeConnect` hook (in `src/index.ts`) validates the `from` query parameter against these patterns before allowing WebSocket connections.

### Client Embedding

The built script (`public/cursors.js`) is included in target websites:

```html
<script src="https://cursor-party.YOUR-WORKER.workers.dev/cursors.js"></script>
```

On load, it:
1. Creates a root div (`cursors-root`) appended to `document.body`
2. Sets `documentElement` to `position: relative` for absolute cursor positioning
3. Connects to the Cloudflare Worker with:
   - Party name: `presence-server` (matches the kebab-cased Durable Object binding `PRESENCE_SERVER`)
   - Room ID: base64-encoded URL path
   - WebSocket URL: `ws(s)://[host]/parties/presence-server/[room-id]`
4. Renders cursor overlays on top of the host website

The Worker's static assets feature serves `public/cursors.js` automatically.

**Important**: The party name `presence-server` is derived from the Durable Object binding name `PRESENCE_SERVER` in `wrangler.toml`, converted to kebab-case. If you rename the binding, update the party name in `src/presence/presence-context.tsx` accordingly.

### Key Features

**Cursor Tracking** (`src/presence/use-cursors.tsx`):
- Tracks mouse/touch movement on document or specific elements
- Sends position updates via Zustand → WebSocket

**Chat** (`src/presence/Chat.tsx`):
- Hidden "secret feature" activated by typing `/`
- Toggle on/off: Set `ENABLE_CHAT = false` in `src/presence/Cursors.tsx`

**Text Highlights** (`src/presence/Highlights.tsx`):
- Uses Rangy library for text selection tracking
- Shows what other users have selected

**Quiet Mode** (`src/presence/QuietMode.tsx`):
- Hides cursors when too many users are present
- Appears automatically when busy

## TypeScript Configuration

- Target: ES2020 with React JSX
- Strict mode enabled
- No emit (Wrangler handles Worker bundling, esbuild handles client bundling)
- Cloudflare Workers types: `@cloudflare/workers-types`
- JSON module imports supported

## Customization Points

To modify cursor appearance or behavior:

- **Cursor tracking scope**: Change `useCursorTracking("document")` → `useCursorTracking("window")` in `src/presence/Cursors.tsx` to track only viewport
- **Cursor visual**: Edit `src/presence/cursor.tsx` to change pointer icon or style
- **Cursor container**: Edit `src/presence/other-cursors.tsx` to adjust z-index or positioning
- **Features**: Toggle `ENABLE_CHAT` or `ENABLE_HIGHLIGHTS` flags in `src/presence/Cursors.tsx`
- **Worker name/URL**: Edit `name` field in `wrangler.toml`
- **Custom domain**: Configure via Cloudflare dashboard (Workers & Pages > Your Worker > Settings > Triggers)

## Key API Differences from PartyKit

This project was migrated from PartyKit to PartyServer (Cloudflare Workers). Key differences:

### Import Changes
- `partykit/server` → `partyserver`
- No `Party` namespace - types exported directly: `Server`, `Connection`, `ConnectionContext`

### Server Class
- Extends `Server` from `partyserver` (not implements `Party.Server`)
- Constructor removed - Durable Objects don't have public constructors
- `this.party.id` → `this.name`
- `this.party.getConnections()` → `this.getConnections()`
- `this.party.broadcast()` → `this.broadcast()`

### Method Signatures
- `onConnect(connection, ctx)` - context is second parameter
- `onMessage(connection, message)` - **order swapped** from PartyKit!
- `onClose(connection, code, reason, wasClean)` - additional parameters
- `onError(connection, error)` - error parameter added

### Configuration
- `static onBeforeConnect` moved to Worker's `routePartykitRequest` options in `src/index.ts`
- No access to `lobby.env` - environment variables accessed from Worker's `env` object

### Hibernation
- Enable via `static options = { hibernate: true }` for automatic cost optimization
