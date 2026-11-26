// A pretend browser for tests: a real Socket.IO client that records what it receives.
import { REALTIME_EVENT_NAMES, type SocketAuth, type UserRole } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { io, type Socket } from "socket.io-client";

export interface LiveClient {
  socket: Socket;
  /** [event, payload], oldest first. */
  events: [string, unknown][];
  named(event: string): unknown[];
}

export function socketToken(app: FastifyInstance, role: UserRole, userId = 1): string {
  return app.jwt.sign({ userId, role, name: `Test ${role}`, use: "socket" }, { expiresIn: 60 });
}

function create(url: string, auth: SocketAuth | Record<string, unknown>, origin?: string) {
  const socket = io(url, {
    auth,
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    ...(origin ? { extraHeaders: { origin } } : {}),
  });
  const events: [string, unknown][] = [];
  for (const name of REALTIME_EVENT_NAMES) socket.on(name, (p: unknown) => events.push([name, p]));
  return {
    socket,
    events,
    named: (event: string) => events.filter(([name]) => name === event).map(([, p]) => p),
  };
}

/** Resolves once connected; rejects with the server's reason if refused. */
export function connectLive(
  url: string,
  auth: SocketAuth | Record<string, unknown>,
  origin?: string,
): Promise<LiveClient> {
  const client = create(url, auth, origin);
  return new Promise((resolve, reject) => {
    client.socket.once("connect", () => resolve(client));
    client.socket.once("connect_error", (error) => {
      client.socket.close();
      reject(error);
    });
  });
}
