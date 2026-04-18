import { Agent, callable, getAgentByName, type Connection } from "agents";
import type { Env } from "./index";
import type PresenceAgent from "./server";

export const DASHBOARD_SINGLETON = "index";

type TrafficEntry = { name: string; count: number };
type DashboardState = {
  traffic: Record<string, TrafficEntry>;
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

  async onStart() {
    await this.scheduleEvery(86400, "reconcile");
  }

  async reconcile() {
    const entries = Object.entries(this.state.traffic).filter(
      ([, entry]) =>
        entry && typeof entry === "object" && typeof entry.name === "string"
    );
    const results = await Promise.all(
      entries.map(async ([href, { name }]) => {
        try {
          const stub = await getAgentByName<Env, PresenceAgent>(
            this.env.PRESENCE_SERVER,
            name
          );
          const count = await stub.getConnectionCount();
          return { href, name, count };
        } catch (err) {
          // Drop on error: reconcile's purpose is to clear stale entries.
          console.error(`Reconcile failed for ${href} (${name}):`, err);
          return { href, name, count: 0 };
        }
      })
    );
    // Atomic apply: input gates don't cover RPC awaits, so this prevents
    // queued updateTraffic calls from being clobbered by a stale snapshot.
    await this.ctx.blockConcurrencyWhile(async () => {
      const next: Record<string, TrafficEntry> = {};
      for (const { href, name, count } of results) {
        if (count > 0) next[href] = { name, count };
      }
      this.setState({ ...this.state, traffic: next });
    });
    this.broadcastState();
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
      const sorted = Object.entries(traffic).sort(
        ([, a], [, b]) => b.count - a.count
      );

      const rows = sorted
        .map(
          ([href, { count }]) =>
            `<tr><td>${count}</td><td><a href="${href}">${href}</a></td></tr>`
        )
        .join("\n");

      const totalUsers = Object.values(traffic).reduce(
        (sum, v) => sum + v.count,
        0
      );

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
  <p id="summary">${sorted.length} active page${sorted.length !== 1 ? "s" : ""}, ${totalUsers} total users</p>
  <table>
    <thead><tr><th>Users</th><th>Page</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=\"2\">No active sessions</td></tr>"}</tbody>
  </table>
<script>
(function() {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function render(traffic) {
    var entries = Object.entries(traffic).sort(function(a, b) {
      return b[1].count - a[1].count;
    });
    var total = entries.reduce(function(s, e) { return s + e[1].count; }, 0);
    var summary = document.getElementById("summary");
    if (summary) {
      summary.textContent = entries.length + " active page" +
        (entries.length !== 1 ? "s" : "") + ", " + total + " total users";
    }
    var tbody = document.querySelector("tbody");
    if (tbody) {
      if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2">No active sessions</td></tr>';
      } else {
        tbody.innerHTML = entries.map(function(e) {
          var href = e[0];
          var count = e[1].count;
          return '<tr><td>' + count + '</td><td><a href="' +
            escapeHtml(href) + '">' + escapeHtml(href) + '</a></td></tr>';
        }).join("");
      }
    }
  }
  var ws;
  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/dashboard");
    ws.onmessage = function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg && msg.type === "state") render(msg.traffic);
      } catch (_) {}
    };
    ws.onclose = function() { setTimeout(connect, 2000); };
    ws.onerror = function() { try { ws.close(); } catch (_) {} };
  }
  connect();
})();
</script>
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
