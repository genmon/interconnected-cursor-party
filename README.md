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

For local development, create a `.dev.vars` file. For production, you'll set environment variables in wrangler.jsonc.

The `WEBSITES` environment variable is an allowlist. It is a JSON array of URL patterns using the [URL Patterns API](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API), and only websites that match one of the patterns will be allowed to connect.

_(This is important to control usage and costs. Very large websites with many concurrent users could result in higher Cloudflare Workers charges.)_

For local development, create `.dev.vars`:

```env
WEBSITES=["http://localhost:*/*", "https://your-website.com/*", "https://(www.)?example.org/*"]
```

For production, set the environment variable in `wrangler.jsonc` or use:

```bash
wrangler secret put WEBSITES
# Then paste your JSON array when prompted
```

(If you do this then remove vars from `wrangler.jsonc` to avoid conflicts.)

### Deploy and test

- Run `npm run deploy`
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
