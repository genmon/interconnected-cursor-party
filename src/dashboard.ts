import { Agent, callable, type Connection } from "agents";
import type { Env } from "./index";

export const DASHBOARD_SINGLETON = "index";

type TrafficEntry = { name: string; count: number };
type DashboardState = {
  traffic: Record<string, TrafficEntry>;
  reconcileScheduleId?: string;
};

export default class DashboardServer extends Agent<Env, DashboardState> {
  static options = {
    hibernate: true,
  };

  initialState: DashboardState = { traffic: {} };

  shouldSendProtocolMessages(): boolean {
    return false;
  }

  private broadcastState() {
    this.broadcast(
      JSON.stringify({ type: "state", traffic: this.state.traffic })
    );
  }

  onConnect(connection: Connection) {
    connection.send(
      JSON.stringify({ type: "state", traffic: this.state.traffic })
    );
  }

  @callable()
  updateTraffic(href: string, userCount: number, name: string) {
    const traffic = { ...this.state.traffic };
    if (userCount <= 0) {
      delete traffic[href];
    } else {
      traffic[href] = { name, count: userCount };
    }
    this.setState({ ...this.state, traffic });
    this.broadcastState();
  }

  async onRequest(req: Request) {
    if (req.method === "GET") {
      const traffic = this.state.traffic;
      const sorted = Object.entries(traffic).sort(([, a], [, b]) => b.count - a.count);

      const rows = sorted
        .map(([href, { count }]) => `<tr><td>${count}</td><td><a href="${href}">${href}</a></td></tr>`)
        .join("\n");

      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Cursor Party Dashboard</title>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
    th:first-child, td:first-child { width: 80px; text-align: right; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>Cursor Party Dashboard</h1>
  <p>${sorted.length} active page${sorted.length !== 1 ? "s" : ""}, ${Object.values(traffic).reduce((sum, v) => sum + v.count, 0)} total users</p>
  <table>
    <thead><tr><th>Users</th><th>Page</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=\"2\">No active sessions</td></tr>"}</tbody>
  </table>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}
