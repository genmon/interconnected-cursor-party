import { routePartykitRequest } from "partyserver";
import PresenceServer from "./server";

// Export the Durable Object class
export { PresenceServer };

// Define the Env interface for TypeScript
export interface Env extends Record<string, unknown> {
  PRESENCE_SERVER: DurableObjectNamespace;
  WEBSITES: string;
  ASSETS: Fetcher;
}

// onBeforeConnect handler for website allowlist
function onBeforeConnect(req: Request, env: Env) {
  // we assume that the request url is encoded into the request query param
  const encodedHomeURL = new URL(req.url).searchParams.get("from");

  if (!encodedHomeURL) {
    return new Response("Not Allowed", { status: 403 });
  }

  const homeURL = new URL(decodeURIComponent(encodedHomeURL));

  const WEBSITES = JSON.parse(env.WEBSITES || "[]") as string[];

  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(homeURL.hostname)) {
    return req;
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

  return req;
}

// Worker fetch handler
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Try PartyKit-style routing first (for WebSocket connections and party routes)
    const partyResponse = await routePartykitRequest(request, env, {
      onBeforeConnect: (req) => onBeforeConnect(req, env),
    });
    if (partyResponse) return partyResponse;

    // If no party route matched, fall through to static assets
    // Cloudflare Workers will automatically serve from the assets directory
    // configured in wrangler.toml
    return new Response("Not found", { status: 404 });
  },
};
