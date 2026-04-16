import { Agent, type Connection, type ConnectionContext } from "agents";
import type { Env } from "./index";
import type {
  Metadata,
  Presence,
  User,
  // ClientMessage,
  PartyMessage,
} from "./presence/presence-schema";
import {
  clientMessageSchema,
  decodeMessage,
  encodePartyMessage,
} from "./presence/presence-schema";

export type ConnectionWithUser = Connection<{
  metadata?: Metadata;
  presence?: Presence;
}>;

const BROADCAST_INTERVAL = 1000 / 60; // 60fps

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers":
    "Origin, X-Requested-With, Content-Type, Accept",
};

// server.ts
export default class PresenceServer extends Agent<Env> {
  static options = {
    hibernate: true,
  };

  // Suppress CF_AGENT_* protocol frames — clients use msgpack, not the Agents SDK protocol
  shouldSendProtocolMessages(): boolean {
    return false;
  }

  // pending updates are stored in memory and sent every tick
  add: { [id: string]: User } = {};
  presence: { [id: string]: Presence } = {};
  remove: string[] = [];

  lastBroadcast = 0;
  interval: ReturnType<typeof setInterval> | null = null;

  onConnect(
    connection: Connection,
    ctx: ConnectionContext
  ): void | Promise<void> {
    const request = ctx.request;
    const metadata = { country: request.cf?.country ?? null } as Metadata;

    // The client may set name and color (from the presence object) in the query string
    const params = new URLSearchParams(request.url.split("?")[1]);
    const presence = {
      name: params.get("name") ?? undefined,
      color: params.get("color") ?? undefined,
    } as Presence;

    // Stash the metadata and the presence on the websocket
    connection.setState((prevState: User) => ({
      presence: { ...prevState?.presence, ...presence },
      metadata,
    }));

    this.join(connection);

    //console.log("onConnect", this.party.id, connection.id, request.cf?.country);
  }

  enqueueAdd(id: string, user: User) {
    this.add[id] = user;
  }

  enqueuePresence(id: string, presence: Presence) {
    this.presence[id] = presence;
  }

  enqueueRemove(id: string) {
    this.remove.push(id);
    delete this.presence[id];
  }

  getUser(connection: ConnectionWithUser): User {
    return {
      presence: connection.state?.presence ?? ({} as Presence),
      metadata: connection.state?.metadata ?? ({} as Metadata),
    };
  }

  makeSyncMessage() {
    // Build users list
    const users = <Record<string, User>>{};
    for (const connection of this.getConnections()) {
      const user = this.getUser(connection);
      users[connection.id] = user;
    }

    return {
      type: "sync",
      users,
    } satisfies PartyMessage;
  }

  join(connection: ConnectionWithUser) {
    // Keep the presence on the websocket. onConnect will add metadata
    connection.setState((prevState) => ({
      ...prevState,
      presence: connection.state?.presence ?? ({} as Presence),
    }));
    this.enqueueAdd(connection.id, this.getUser(connection));
    // Reply with the current presence of all connections, including self
    const sync = this.makeSyncMessage();
    //connection.send(JSON.stringify(sync));
    //console.log("sync", JSON.stringify(sync, null, 2));
    connection.send(encodePartyMessage(sync));
  }

  leave(connection: ConnectionWithUser) {
    this.enqueueRemove(connection.id);
    this.scheduleBroadcast().catch((err) => {
      console.error(err);
    });
  }

  onMessage(
    connection: ConnectionWithUser,
    message: string | ArrayBuffer | ArrayBufferView
  ): void | Promise<void> {
    //const message = JSON.parse(msg as string) as ClientMessage;
    // Convert ArrayBufferView to ArrayBuffer if needed
    const messageData =
      message instanceof ArrayBuffer
        ? message
        : typeof message === "string"
          ? message
          : message.buffer;
    const result = clientMessageSchema.safeParse(decodeMessage(messageData));
    if (!result.success) return;
    const parsedMessage = result.data;
    /*console.log(
      "onMessage",
      this.name,
      connection.id,
      JSON.stringify(parsedMessage, null, 2)
    );*/
    switch (parsedMessage.type) {
      case "update": {
        // A presence update, replacing the existing presence
        connection.setState((prevState) => {
          this.enqueuePresence(connection.id, parsedMessage.presence);
          return {
            ...prevState,
            presence: parsedMessage.presence,
          };
        });
        break;
      }
    }

    this.scheduleBroadcast().catch((err) => {
      console.error(err);
    });
  }

  onClose(
    connection: ConnectionWithUser,
    code: number,
    reason: string,
    wasClean: boolean
  ) {
    this.leave(connection);
  }

  onError(connection: ConnectionWithUser, error: unknown) {
    this.leave(connection);
  }

  async scheduleBroadcast() {
    // Broadcasts deltas. Looks at lastBroadcast
    // - If it's longer ago than BROADCAST_INTERVAL, broadcasts immediately
    // - If it's less than BROADCAST_INTERVAL ago, schedules an alarm
    //   to broadcast later
    const now = Date.now();
    const ago = now - this.lastBroadcast;
    if (ago >= BROADCAST_INTERVAL) {
      this._broadcast();
    } else {
      if (!this.interval) {
        this.interval = setInterval(() => {
          this._broadcast();
          if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
          }
        }, BROADCAST_INTERVAL - ago);
      }
    }
  }

  _broadcast() {
    this.lastBroadcast = Date.now();

    // Avoid the situation where there's only one connection and we're
    // rebroadcasting its own deltas to it
    const connections = [...this.getConnections()];
    const presenceUniqueIds = new Set(Object.keys(this.presence));
    if (
      connections.length === 1 &&
      this.remove.length === 0 &&
      Object.keys(this.add).length === 0 &&
      presenceUniqueIds.size === 1 &&
      presenceUniqueIds.has(connections[0].id)
    ) {
      this.presence = {};
      return;
    }

    const update = {
      type: "changes",
      add: this.add,
      presence: this.presence,
      remove: this.remove,
    } satisfies PartyMessage;
    //this.broadcast(JSON.stringify(update));
    const encoded = encodePartyMessage(update);
    this.broadcast(encoded);
    this.add = {};
    this.presence = {};
    this.remove = [];
  }

  async onRequest(req: Request) {
    if (req.method === "GET") {
      // For SSR, return the current presence of all connections
      const users = [...this.getConnections()].reduce(
        (acc, user) => ({ ...acc, [user.id]: this.getUser(user) }),
        {}
      );
      return Response.json({ users }, { status: 200, headers: CORS });
    }

    // respond to cors preflight requests
    if (req.method === "OPTIONS") {
      return Response.json({ ok: true }, { status: 200, headers: CORS });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}
