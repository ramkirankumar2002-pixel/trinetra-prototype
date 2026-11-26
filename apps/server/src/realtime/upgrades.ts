// Two kinds of WebSocket share port 4000: browsers (Socket.IO) and devices (/device).
// @fastify/websocket would take every upgrade, including Socket.IO's, so it is given
// this gate to listen on instead of the HTTP server.
import { EventEmitter } from "node:events";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

export const SOCKET_IO_PATH = "/socket.io/";

/** Passes on every upgrade request except Socket.IO's own. */
export function upgradesWithoutSocketIo(server: Server): Server {
  const gate = new EventEmitter();
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!request.url?.startsWith(SOCKET_IO_PATH)) gate.emit("upgrade", request, socket, head);
  });
  // The plugin only ever calls on() and removeListener() on it.
  return gate as unknown as Server;
}
