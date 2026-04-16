import { getAgentByName } from "agents";
import PresenceServer from "./server";
import DashboardServer from "./dashboard";
import { DASHBOARD_SINGLETON } from "./dashboard";

// Export the Durable Object class
export { PresenceServer, DashboardServer };

// Define the Env interface for TypeScript
export interface Env extends Record<string, unknown> {
  PRESENCE_SERVER: DurableObjectNamespace<PresenceServer>;
  DASHBOARD_SERVER: DurableObjectNamespace<DashboardServer>;
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
      const agent = await getAgentByName<Env, PresenceServer>(
        env.PRESENCE_SERVER,
        roomId
      );
      return agent.fetch(request);
    }

    // Dashboard route
    if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) {
      const dashboard = await getAgentByName<Env, DashboardServer>(
        env.DASHBOARD_SERVER,
        DASHBOARD_SINGLETON
      );
      return dashboard.fetch(request);
    }

    // Non-party requests: fall through to static assets
    // Cloudflare Workers will automatically serve from the assets directory
    // configured in wrangler.jsonc
    return new Response("Not found", { status: 404 });
  },
};
