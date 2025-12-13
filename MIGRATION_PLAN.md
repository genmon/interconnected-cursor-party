# Migration Plan: PartyKit → PartyServer (Cloudflare Workers)

## Overview

Migrate from PartyKit platform to Cloudflare's PartyServer (Durable Objects) framework. The key changes:
- Replace `partykit/server` imports with `partyserver`
- Replace `partykit.json` with `wrangler.toml` configuration
- Create a Worker entrypoint that uses `routePartykitRequest()`
- Handle static asset serving using Cloudflare Workers Static Assets (introduced Sept 2024)
- Set up external build process for client bundle (since PartyServer doesn't have built-in bundling)

## Research Findings

### Current PartyKit "serve" Functionality
The `partykit.json` "serve" parameter currently:
- Serves static files from `public/` directory
- Uses esbuild to bundle `src/cursors.tsx` → `public/cursors.js` (IIFE format)
- Aliases React to Preact for smaller bundle
- Runs `scripts/splash-script.mjs` before build
- Serves as SPA with custom caching headers

### PartyServer Differences
- No built-in static file serving or build tooling
- Must manually configure Durable Object bindings in `wrangler.toml`
- Uses `routePartykitRequest()` for URL routing: `/:server/:name` pattern
- Relies on Cloudflare Workers native features (static assets, etc.)

**Sources:**
- [PartyServer README](https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md)
- [Cloudflare Agents - routePartykitRequest](https://developers.cloudflare.com/agents/concepts/agent-class/)
- [PartyKit Configuration Docs](https://docs.partykit.io/reference/partykit-configuration/)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)

## Migration Steps

### Phase 1: Dependencies and Configuration

- [ ] Install PartyServer dependencies
  ```bash
  npm install partyserver
  npm install -D wrangler
  ```

- [ ] Create `wrangler.toml` configuration file
  - [ ] Configure basic Worker settings (name, main entry point, compatibility date)
  - [ ] Set up Durable Objects binding for PresenceServer
  - [ ] Configure Durable Objects migrations
  - [ ] Configure static assets (directory: `./public`, SPA mode)
  - [ ] Set up environment variables binding for `WEBSITES` allowlist

- [ ] Update `.gitignore` to exclude Wrangler build artifacts
  - [ ] Add `.wrangler/`
  - [ ] Add `wrangler.toml` secrets if needed

### Phase 2: Server Code Migration

- [ ] Update `src/server.ts` imports
  - [ ] Change `import type * as Party from "partykit/server"` to `import type * as Party from "partyserver"`
  - [ ] Verify all Party types still exist in PartyServer (Server, Connection, Request, etc.)
  - [ ] Update any PartyKit-specific APIs that may have changed

- [ ] Review `onBeforeConnect` static method compatibility
  - [ ] Verify `Party.Lobby` type exists in PartyServer
  - [ ] Confirm `lobby.env.WEBSITES` access pattern works
  - [ ] Test URLPattern API usage (should work as it's a web standard)

- [ ] Test hibernation compatibility
  - [ ] Verify `options: { hibernate: true }` is supported in PartyServer

### Phase 3: Worker Entry Point

- [ ] Create `src/index.ts` (or `src/worker.ts`) as the Worker entry point
  - [ ] Import `routePartykitRequest` from `partyserver`
  - [ ] Import the PresenceServer class
  - [ ] Implement the `fetch` handler that calls `routePartykitRequest()`
  - [ ] Handle non-PartyKit routes (let static assets take over)
  - [ ] Example structure:
    ```typescript
    import { routePartykitRequest } from "partyserver";
    import PresenceServer from "./server";

    export { PresenceServer };

    export default {
      async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        // Try PartyKit routing first
        const res = await routePartykitRequest(request, env);
        if (res) return res;

        // Fall through to static assets (handled by Cloudflare Workers)
        return new Response("Not found", { status: 404 });
      }
    };
    ```

- [ ] Define TypeScript types for `Env` interface
  - [ ] Add Durable Object bindings (e.g., `PRESENCE_SERVER: DurableObjectNamespace`)
  - [ ] Add environment variables (e.g., `WEBSITES: string`)

### Phase 4: Client Build Process

Since PartyServer doesn't have built-in bundling, we need an external build setup:

- [ ] Create a build script for the client bundle
  - [ ] Option A: Use esbuild CLI directly in package.json scripts
  - [ ] Option B: Create a custom Node.js build script (similar to `scripts/splash-script.mjs`)
  - [ ] Option C: Use Vite or another bundler

- [ ] Configure the build to:
  - [ ] Bundle `src/cursors.tsx` → `public/cursors.js`
  - [ ] Use IIFE format (for script tag inclusion)
  - [ ] Alias `react` and `react-dom` to `@preact/compat`
  - [ ] Define `PARTYKIT_HOST` global (may need to be dynamic based on deployment)
  - [ ] Minify for production
  - [ ] Generate source maps

- [ ] Update `package.json` scripts
  - [ ] `dev`: Build client + run `wrangler dev`
  - [ ] `build`: Build client bundle
  - [ ] `deploy`: Build client + run `wrangler deploy`
  - [ ] Consider adding a watch mode for client development

- [ ] Handle the splash script (`scripts/splash-script.mjs`)
  - [ ] Determine if still needed (it generates the welcome page)
  - [ ] Integrate into build process or run separately

### Phase 5: Static Assets Configuration

- [ ] Configure Cloudflare Workers static assets in `wrangler.toml`
  - [ ] Set `assets.directory = "./public"`
  - [ ] Enable SPA mode: `assets.not_found_handling = "single-page-application"`
  - [ ] Consider adding `assets.binding = "ASSETS"` if programmatic access needed
  - [ ] Configure caching headers (equivalent to `browserTTL: 0, edgeTTL: null`)

- [ ] Verify static files are served correctly:
  - [ ] `public/index.html` (welcome page)
  - [ ] `public/cursors.js` (bundled client)
  - [ ] `public/cursors.js.map` (source map)
  - [ ] `public/styles.css`, `public/normalize.css`
  - [ ] `public/PartyKit.png`, `public/favicon.ico`
  - [ ] `public/meta.js`

### Phase 6: Environment Variables & Secrets

- [ ] Set up environment variables in Cloudflare
  - [ ] Add `WEBSITES` variable via `wrangler secret put` or dashboard
  - [ ] Or use `.dev.vars` for local development

- [ ] Update `.env.example` with instructions for Cloudflare Workers
  - [ ] Note that Cloudflare uses Secrets/Environment Variables, not `.env` files

### Phase 7: Testing & Validation

- [ ] Test local development
  - [ ] Run `wrangler dev` and verify WebSocket connections work
  - [ ] Test cursor tracking on the welcome page
  - [ ] Verify allowlist enforcement (`onBeforeConnect` logic)
  - [ ] Test chat and highlights features

- [ ] Test production deployment
  - [ ] Deploy to Cloudflare Workers: `wrangler deploy`
  - [ ] Verify the deployed URL works
  - [ ] Test embedding the script tag on an external website
  - [ ] Verify CORS headers work correctly

- [ ] Performance testing
  - [ ] Verify Durable Objects hibernation works (reduces costs)
  - [ ] Check static asset caching headers
  - [ ] Test with multiple concurrent users

### Phase 8: Documentation Updates

- [ ] Update `README.md`
  - [ ] Replace PartyKit CLI commands with Wrangler commands
  - [ ] Update deployment instructions
  - [ ] Update environment variable setup
  - [ ] Change authentication from `npx partykit login` to Cloudflare Workers auth

- [ ] Update `CLAUDE.md`
  - [ ] Replace PartyKit references with PartyServer
  - [ ] Update development commands section
  - [ ] Update architecture section to reflect Cloudflare Workers setup
  - [ ] Document the wrangler.toml configuration

- [ ] Update or remove `partykit.json`
  - [ ] Can be deleted after migration is complete
  - [ ] Or keep for reference with a note that it's deprecated

### Phase 9: Cleanup

- [ ] Remove old PartyKit dependencies
  - [ ] `npm uninstall partykit` (if no longer needed)
  - [ ] Keep `partysocket` for client-side WebSocket usage

- [ ] Clean up unused files
  - [ ] Archive or delete `partykit.json`

- [ ] Update `.cursorrules` or `.github/copilot-instructions.md` if they exist

## Open Questions to Resolve

1. **✅ PARTYKIT_HOST definition** (RESOLVED):
   - Solution: Use `window.location.host` in dev mode for auto-detection
   - In production, optionally set `PARTYKIT_HOST` env var during build
   - Default behavior works for both dev and production

2. **✅ Splash script integration** (RESOLVED):
   - Integrated into `scripts/build-client.mjs`
   - Runs automatically before bundling the client
   - Generates `public/meta.js` with WEBSITES configuration

3. **✅ URL routing pattern** (RESOLVED):
   - PartyKit uses `/:party/:room` pattern
   - PartyServer's `routePartykitRequest` uses `/parties/:server/:name`
   - Solution: Set `party: "presence-server"` in client (matches kebab-cased binding name)

4. **✅ Durable Object naming** (RESOLVED):
   - Binding name: `PRESENCE_SERVER` in wrangler.toml
   - Class name: `PresenceServer`
   - URL path: `presence-server` (auto-converted to kebab-case)

5. **Cost implications**:
   - Understand Cloudflare Workers pricing vs. PartyKit
   - Optimize for Durable Objects hibernation

## Success Criteria

- [ ] WebSocket connections work in local development (`wrangler dev`)
- [ ] Static assets (cursors.js, index.html, etc.) are served correctly
- [ ] Deployment to Cloudflare Workers succeeds
- [ ] External websites can embed the script tag and see multiplayer cursors
- [ ] Website allowlist enforcement works
- [ ] Chat and highlights features function correctly
- [ ] Documentation is updated and accurate

## Rollback Plan

If migration fails:
1. Keep original `partykit.json` in version control
2. Can redeploy to PartyKit using original setup
3. No changes to `src/presence/` client code, so embedded scripts continue working
