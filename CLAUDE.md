# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cursor Party is a multiplayer cursor tracking system built on PartyKit. It allows any website to add real-time collaborative cursors by including a single script tag. The project consists of:

- **Backend**: PartyKit server (`src/server.ts`) that manages WebSocket connections and broadcasts cursor positions
- **Frontend**: React/Preact client (`src/cursors.tsx`) that runs embedded in target websites via a script tag

## Development Commands

```bash
# Local development with hot reload
npx partykit dev

# Deploy to PartyKit platform (includes environment variables from .env)
npm run deploy

# Login to PartyKit (needed before first deploy)
npx partykit login

# Check current PartyKit user
npx partykit whoami
```

## Architecture

### PartyKit Configuration

`partykit.json` defines the server structure:
- **Main server**: `src/server.ts` - WebSocket presence server
- **Static serving**: `public/` directory with SPA support
- **Build process**: Bundles `src/cursors.tsx` → `public/cursors.js` (IIFE format)
- **React alias**: Uses `@preact/compat` for smaller bundle size
- **Pre-deploy hook**: Runs `scripts/splash-script.mjs` to generate welcome page

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

- **Server state** (`server.ts`): Queues updates and broadcasts deltas at 60fps to avoid overwhelming clients

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

The `.env` file contains a `WEBSITES` JSON array of URL patterns (using URLPattern API). Only matching websites can connect to prevent abuse:

```env
WEBSITES=["https://cursor-party.YOUR-USERNAME-HERE.partykit.dev/*", "https://(www.)?example.org/*"]
```

The server's `onBeforeConnect` hook validates the `from` query parameter against these patterns.

### Client Embedding

The built script (`public/cursors.js`) is included in target websites:

```html
<script src="https://cursor-party.YOUR-USERNAME-HERE.partykit.dev/cursors.js"></script>
```

On load, it:
1. Creates a root div (`cursors-root`) appended to `document.body`
2. Sets `documentElement` to `position: relative` for absolute cursor positioning
3. Connects to PartyKit server with room ID = base64-encoded URL path
4. Renders cursor overlays on top of the host website

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
- No emit (PartyKit handles bundling)
- JSON module imports supported

## Customization Points

To modify cursor appearance or behavior:

- **Cursor tracking scope**: Change `useCursorTracking("document")` → `useCursorTracking("window")` in `src/presence/Cursors.tsx` to track only viewport
- **Cursor visual**: Edit `src/presence/cursor.tsx` to change pointer icon or style
- **Cursor container**: Edit `src/presence/other-cursors.tsx` to adjust z-index or positioning
- **Features**: Toggle `ENABLE_CHAT` or `ENABLE_HIGHLIGHTS` flags in `src/presence/Cursors.tsx`
