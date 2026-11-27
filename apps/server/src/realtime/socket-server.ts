// Socket.IO for the browsers. The backend puts each connection in its room; a browser
// cannot choose a room and nothing it sends is listened to.
import {
  SOCKET_ERRORS,
  supervisorRoom,
  type ClientToServerEvents,
  type Room,
  type ServerToClientEvents,
  type UserRole,
} from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import type { TokenPayload } from "../auth/tokens";
import { webOrigins, type Env } from "../config/env";
import { assertAudience, type Publish } from "./publish";
import { SOCKET_IO_PATH } from "./upgrades";

type Viewer =
  | { kind: "live" }
  | { kind: "user"; userId: number; role: UserRole; name: string; sessionEndsAt?: number };

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  { viewer: Viewer }
>;

function roomFor(viewer: Viewer): Room {
  if (viewer.kind === "live") return "live";
  if (viewer.role === "KIOSK") return "kiosk";
  if (viewer.role === "STORE") return "store";
  return supervisorRoom(viewer.userId);
}

/** For the log: who it is, and nothing secret. */
const describe = (viewer: Viewer) =>
  viewer.kind === "live"
    ? { role: "LIVE" }
    : { role: viewer.role, userId: viewer.userId, user: viewer.name };

export interface SocketServer {
  io: RealtimeServer;
  publish: Publish;
  /** Runs for each new connection, after it has joined its room. */
  onJoin(listener: (room: Room, emit: Publish) => void): void;
  close(): Promise<void>;
}

export function createSocketServer(app: FastifyInstance, env: Env): SocketServer {
  const origins = webOrigins(env);
  const io: RealtimeServer = new Server(app.server, {
    path: SOCKET_IO_PATH,
    serveClient: false,
    // Browsers send nothing, so anything large is not from our website.
    maxHttpBufferSize: 4096,
    cors: { origin: origins, credentials: true },
    // CORS does not cover WebSockets, so the Origin is checked here as well. Browsers
    // always send it; a request without one is not from a web page.
    allowRequest: (request, decide) => {
      const origin = request.headers.origin;
      decide(null, origin === undefined || origins.includes(origin));
    },
    // Other upgrade requests belong to /device.
    destroyUpgrade: false,
  });

  const joinListeners: ((room: Room, emit: Publish) => void)[] = [];

  io.use((socket, next) => {
    const refuse = (reason: string) => {
      app.log.warn({ reason, ip: socket.handshake.address }, "refused a live connection");
      next(new Error(reason));
    };
    const { token, live } = socket.handshake.auth as { token?: unknown; live?: unknown };

    if (token === undefined) {
      if (live !== true) return refuse(SOCKET_ERRORS.required);
      socket.data.viewer = { kind: "live" };
      return next();
    }
    // A token that fails is refused, even if the live room was also asked for.
    let payload: TokenPayload;
    try {
      if (typeof token !== "string") throw new Error("not a string");
      payload = app.jwt.verify<TokenPayload>(token);
    } catch {
      return refuse(SOCKET_ERRORS.invalid);
    }
    // A login cookie is not a socket token.
    if (payload.use !== "socket") return refuse(SOCKET_ERRORS.invalid);

    const { userId, role, name, sessionEndsAt } = payload;
    socket.data.viewer = {
      kind: "user",
      userId,
      role,
      name,
      ...(sessionEndsAt === undefined ? {} : { sessionEndsAt }),
    };
    next();
  });

  io.on("connection", (socket) => {
    const { viewer } = socket.data;
    const room = roomFor(viewer);
    void socket.join(room);
    app.log.info(describe(viewer), "live connection opened");

    // The token is checked only when connecting, so end the connection with the login.
    let sessionTimer: NodeJS.Timeout | undefined;
    if (viewer.kind === "user" && viewer.sessionEndsAt !== undefined) {
      const remaining = Math.max(0, viewer.sessionEndsAt * 1000 - Date.now());
      sessionTimer = setTimeout(() => socket.disconnect(true), remaining).unref();
    }
    socket.on("disconnect", (reason) => {
      clearTimeout(sessionTimer);
      app.log.info({ ...describe(viewer), reason }, "live connection closed");
    });

    // Sends to this one connection only, with the same audience rules as publish().
    const emitToSocket: Publish = (event, rooms, payload) => {
      assertAudience(event, rooms);
      if (rooms.includes(room)) socket.emit(event, ...([payload] as never));
    };
    for (const listener of joinListeners) listener(room, emitToSocket);
  });

  return {
    io,
    publish: (event, rooms, payload) => {
      assertAudience(event, rooms);
      io.to([...rooms]).emit(event, ...([payload] as never));
    },
    onJoin: (listener) => void joinListeners.push(listener),
    // Not io.close(): that would also close the HTTP server, which Fastify closes itself.
    close: async () => {
      io.disconnectSockets(true);
      io.engine.close();
    },
  };
}
