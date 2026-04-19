# Cursor Party

**🎈 Easily add multiplayer cursors to any website.**

Follow these instructions and add one script tag. It works on static websites and web apps too.

_Why?_

- Vibes
- Because you can start here and then customize.

👉 See it in action on [interconnected.org](https://interconnected.org).

## tl;dr

```console
$ git clone https://github.com/genmon/interconnected-cursor-party.git  # this repo
$ cd cursor-party
$ npm install
$ cp .dev.vars.example .dev.vars  # if it exists, or create .dev.vars
$ npx wrangler login  # authenticate with Cloudflare
$ vi .dev.vars  # set your WEBSITES allowlist for local dev
$ npm run deploy  # deploy to Cloudflare Workers
```

Now add `<script src="https://cursor-party.YOUR-CLOUDFLARE-NAME.workers.dev/cursors.js"></script>` in your HTML, just before the closing `</body>` tag.

Get fixes and new features by periodically running `git pull`.

Welcome to the party, pal!

## Getting Started

_Follow these instructions if you don't want to customize the display of the cursors._

### What you'll need

- A development machine with [Node.js](https://nodejs.org/en/) installed (v22 or higher recommended)
- A [Cloudflare](https://cloudflare.com) account

### Clone this repo and authenticate with Cloudflare

```console
$ git clone https://github.com/genmon/interconnected-cursor-party.git  # wherever you keep code
$ npm install
$ npx wrangler login  # authenticate with Cloudflare
```

### Test your installation (local development only)

Type `npm run dev`.

Go to `http://localhost:8787` in your browser. You should see a Cursor Party welcome page. Open another browser to the same page and confirm that they share multiplayer cursors.

When you deploy this to Cloudflare Workers, it will act as your backend for multiplayer cursors on any website you configure.

### Configure and deploy your Cloudflare Worker

There are two environment variables you need to set.

#### `WEBSITES` (allowlist)

A JSON array of URL patterns using the [URL Patterns API](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API). Only websites matching one of the patterns can connect.

_(Important: controls usage and costs. Large sites with many concurrent users can run up Cloudflare Workers charges.)_

For **local development**, create `.dev.vars`:

```env
WEBSITES=["http://localhost:*/*", "https://your-website.com/*", "https://(www.)?example.org/*"]
```

For **production**, set in `wrangler.jsonc` or via:

```bash
wrangler secret put WEBSITES
# Then paste your JSON array when prompted
```

(If you use `wrangler secret`, remove `WEBSITES` from `wrangler.jsonc` to avoid conflicts.)

#### `WORKER_HOST` (required for production)

The hostname of your deployed Worker, e.g. `cursor-party.YOUR-ACCOUNT.workers.dev`. The build bakes this into `public/cursors.js` so that when the script runs on another site (e.g. `example.org`), it connects back to your Worker instead of the embedding site.

For **local development**, the build uses `window.location.host` and you can ignore this.

For **local production builds** (`npm run deploy` from your machine), create a `.env` file:

```env
WORKER_HOST=cursor-party.YOUR-ACCOUNT.workers.dev
```

For **automatic deploys via Cloudflare Workers Builds** (GitHub-integrated), set it in the Cloudflare dashboard: Worker → Settings → **Build → Variables and secrets** → add `WORKER_HOST` as a plain variable. The dashboard-defined variable flows into `npm run build`, which runs in production mode.

### Deploy and test

- Run `npm run deploy` (or push to GitHub if you've set up Cloudflare Workers Builds)
- In your browser, visit `https://cursor-party.YOUR-CLOUDFLARE-NAME.workers.dev`

You should see the same welcome page as before.

Make a note of the script tag. It will look something like:

```html
<script src="https://cursor-party.YOUR-CLOUDFLARE-NAME.workers.dev/cursors.js"></script>
```

You can also set up a custom domain for your Worker via the Cloudflare dashboard.

### Add multiplayer cursors to your website

The final step is to add the script tag from the previous step to the HTML of your website. Add it just before the closing `</body>` tag.

Now you can test your website. Open two browsers to your website and you should see multiplayer cursors.

🎈 You're done!

BONUS SECRET FEATURE: type `/` to cursor chat with other users.

### Stay up to date

Run `git pull` periodically in your working directory for new features and fixes. Also run `npm install` to keep the dependencies up to date, then redeploy with `npm run deploy`.

## Development

### npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Builds the client in **development mode** (`WORKER_HOST = window.location.host`), then starts `wrangler dev` on `http://localhost:8787`. |
| `npm run build:client` | Runs only the esbuild step in development mode. |
| `npm run build` | Runs the esbuild step in **production mode** (`NODE_ENV=production`). Requires `WORKER_HOST` env var. This is what Cloudflare Workers Builds invokes. |
| `npm run deploy` | `npm run build && wrangler deploy` — production bundle, then push to Cloudflare. |
| `npm run preview` | Dev build + `wrangler dev --remote` for testing against live Cloudflare infra. |

### Automatic deploys via Cloudflare Workers Builds

You can connect your fork to Cloudflare Workers Builds so every push to `main` deploys automatically:

1. In the Cloudflare dashboard, go to your Worker → Settings → **Build**.
2. Connect the GitHub repository.
3. Set the **Build command** to `npm run build` and the **Deploy command** to `npx wrangler deploy`.
4. Under **Variables and secrets**, add `WORKER_HOST` (plain variable) with the value of your Worker's hostname.
5. `WEBSITES` — set as either a `wrangler.jsonc` var or via `wrangler secret put WEBSITES`, not as a Cloudflare Workers Builds variable.

## Disabling secret cursor chat

- In `src/presence/Cursors.tsx` set `ENABLE_CHAT = false`

## Disabling the presence counter

- In `src/presence/Cursors.tsx` set `SHOW_PRESENCE_COUNTER = false`

## Customizing the display of the cursors

You can modify the code in this repo to change the display of the cursors. You'll need to be familiar with JavaScript and CSS.

- Instead of cloning this repo, fork it to your own GitHub account
- `src/presence/Cursors.tsx`: To make the cursors fit in the browser windows instead of over the full document, change the hook to read: `useCursorTracking("document")`
- `src/presence/other-cursors.tsx`: Change the cursor container here, for example to change the z-index
- `src/presence/cursor.tsx`: Change the appearance of a cursor here, for example to swap out the pointer for an image of your choosing.

### Customizing your Worker name

Edit `wrangler.jsonc` and change the `name` field to customize your Worker's URL.

## Dashboard

The Worker serves a real-time leaderboard at `/dashboard` — an HTML page that lists every page currently hosting cursors, ranked by active user count, and updates live as people come and go.

In production, visit:

```
https://cursor-party.YOUR-ACCOUNT.workers.dev/dashboard
```

Behind the scenes, the page opens a WebSocket to the same path (`wss://cursor-party.YOUR-ACCOUNT.workers.dev/dashboard`). A single `DashboardServer` Durable Object aggregates traffic from all presence rooms and broadcasts state to connected dashboard clients, throttled to 4Hz.

Unlike the cursor protocol (which uses msgpack), dashboard messages are plain JSON. The server sends one message type:

```json
{
  "type": "state",
  "traffic": {
    "https://example.org/": { "name": "aHR0cHM6Ly9leGFtcGxlLm9yZy8", "count": 3 },
    "https://example.org/about": { "name": "aHR0cHM6Ly9leGFtcGxlLm9yZy9hYm91dA", "count": 1 }
  }
}
```

- Keys in `traffic` are the full page URLs.
- `name` is the opaque ID of the presence room reporting the traffic (the base64-encoded URL path used as the Durable Object room name).
- `count` is the number of currently connected users on that page.

The dashboard is receive-only; the server closes the connection if a client tries to send anything.
