// The live connection to the backend. It only receives: weights and statuses are shown,
// and nothing the browser holds is ever sent back as a weight.
import type { ClientToServerEvents, ServerToClientEvents } from "@trinetra/shared";
import { io, type Socket } from "socket.io-client";
import { apiUrl, socketUrl } from "./config";

export type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus =
  /** Not started, or stopped on purpose. */
  | "idle"
  | "connecting"
  | "connected"
  /** The connection was lost: trying again. */
  | "reconnecting"
  /** The login has ended, or there is none. Trying again cannot help. */
  | "login-required";

export interface SocketClient {
  socket: LiveSocket;
  connect(): void;
  disconnect(): void;
  getStatus(): ConnectionStatus;
  subscribeStatus(listener: () => void): () => void;
  /** Runs after a lost connection comes back: reload data, because events were missed. */
  onReconnect(listener: () => void): () => void;
}

export interface SocketClientOptions {
  socketUrl: string;
  apiUrl: string;
  /** "live" is the read-only room that needs no login (the projector screen). */
  mode?: "user" | "live";
  fetch?: typeof fetch;
  /** First wait before trying again after a refusal; it doubles up to ten times this. */
  retryMs?: number;
}

export function createSocketClient(options: SocketClientOptions): SocketClient {
  const { mode = "user", retryMs = 1000 } = options;
  const statusListeners = new Set<() => void>();
  const reconnectListeners = new Set<() => void>();

  let status: ConnectionStatus = "idle";
  let wanted = false;
  let hasConnected = false;
  let loginEnded = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let nextDelay = retryMs;

  function setStatus(next: ConnectionStatus) {
    if (next === status) return;
    status = next;
    statusListeners.forEach((listener) => listener());
  }

  /** A socket token lasts 60 seconds, so a new one is fetched for every connection. */
  async function fetchToken(): Promise<string> {
    const send = options.fetch ?? fetch;
    const response = await send(`${options.apiUrl}/api/auth/socket-token`, {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401) loginEnded = true;
    if (!response.ok) throw new Error(`socket token: HTTP ${response.status}`);
    return ((await response.json()) as { token: string }).token;
  }

  const socket: LiveSocket = io(options.socketUrl, {
    autoConnect: false,
    // Socket.IO calls this again on every reconnection.
    auth:
      mode === "live"
        ? { live: true }
        : (send) => {
            loginEnded = false;
            fetchToken().then(
              (token) => wanted && send({ token }),
              // No token: the backend refuses, and "connect_error" decides what next.
              () => wanted && send({}),
            );
          },
  });

  /** Socket.IO does not retry by itself after a refusal or a disconnect by the server. */
  function retryLater() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => wanted && socket.connect(), nextDelay);
    nextDelay = Math.min(nextDelay * 2, retryMs * 10);
  }

  socket.on("connect", () => {
    nextDelay = retryMs;
    setStatus("connected");
    if (hasConnected) reconnectListeners.forEach((listener) => listener());
    hasConnected = true;
  });

  socket.on("disconnect", (reason) => {
    if (!wanted) return;
    setStatus("reconnecting");
    if (reason === "io server disconnect") retryLater();
  });

  socket.on("connect_error", () => {
    if (!wanted) return;
    if (loginEnded) {
      wanted = false;
      socket.disconnect();
      setStatus("login-required");
      return;
    }
    setStatus(hasConnected ? "reconnecting" : "connecting");
    // active: Socket.IO is already retrying (the server could not be reached).
    if (!socket.active) retryLater();
  });

  return {
    socket,
    connect() {
      if (wanted) return;
      wanted = true;
      hasConnected = false;
      nextDelay = retryMs;
      setStatus("connecting");
      socket.connect();
    },
    disconnect() {
      wanted = false;
      clearTimeout(retryTimer);
      socket.disconnect();
      setStatus("idle");
    },
    getStatus: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },
    onReconnect(listener) {
      reconnectListeners.add(listener);
      return () => void reconnectListeners.delete(listener);
    },
  };
}

let shared: SocketClient | undefined;

/** The one logged-in connection a page shares. Use in the browser only. */
export function socketClient(): SocketClient {
  shared ??= createSocketClient({ socketUrl: socketUrl(), apiUrl: apiUrl() });
  return shared;
}
