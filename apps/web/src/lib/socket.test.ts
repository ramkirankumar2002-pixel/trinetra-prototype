// The browser's socket client against a real Socket.IO server.
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSocketClient, type SocketClient, type SocketClientOptions } from "./socket";

let http: HttpServer;
let server: Server;
let url: string;
let auths: unknown[];
let accept: (auth: { token?: string; live?: boolean }) => boolean;
let tokenCalls: { url: string; init: RequestInit | undefined }[];
let tokenStatus: number;
let client: SocketClient | undefined;

beforeEach(async () => {
  auths = [];
  tokenCalls = [];
  tokenStatus = 200;
  accept = (auth) => !!auth.token || auth.live === true;
  http = createServer();
  server = new Server(http);
  server.use((socket, next) => {
    auths.push(socket.handshake.auth);
    next(accept(socket.handshake.auth) ? undefined : new Error("INVALID_TOKEN"));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});

afterEach(async () => {
  client?.disconnect();
  await server.close();
});

/** Hands out token-1, token-2, ... like the backend, or fails with tokenStatus. */
const fakeFetch = (async (input: string, init?: RequestInit) => {
  tokenCalls.push({ url: input, init });
  return new Response(JSON.stringify({ token: `token-${tokenCalls.length}` }), {
    status: tokenStatus,
  });
}) as typeof fetch;

function start(options: Partial<SocketClientOptions> = {}) {
  client = createSocketClient({
    socketUrl: url,
    apiUrl: "http://api.test",
    fetch: fakeFetch,
    retryMs: 20,
    ...options,
  });
  client.connect();
  return client;
}

const until = (check: () => void) => vi.waitFor(check, { timeout: 8000, interval: 10 });
const connected = (c: SocketClient) => until(() => expect(c.getStatus()).toBe("connected"));

describe("socket client", () => {
  it("gets a socket token with the login cookie and connects with it", async () => {
    await connected(start());

    expect(tokenCalls[0]!.url).toBe("http://api.test/api/auth/socket-token");
    expect(tokenCalls[0]!.init).toMatchObject({ credentials: "include" });
    expect(auths).toEqual([{ token: "token-1" }]);
  });

  it("reconnects with a fresh token after the connection drops", async () => {
    const c = start();
    const reloads = vi.fn();
    c.onReconnect(reloads);
    await connected(c);
    expect(reloads).not.toHaveBeenCalled();

    // The network drops: the transport closes under the connection.
    server.sockets.sockets.forEach((socket) => socket.conn.close());
    await until(() => expect(auths).toHaveLength(2));
    await connected(c);

    expect(auths[1]).toEqual({ token: "token-2" });
    expect(reloads).toHaveBeenCalledTimes(1);
  });

  it("reconnects when the server ends the connection", async () => {
    const c = start();
    const reloads = vi.fn();
    c.onReconnect(reloads);
    await connected(c);

    server.disconnectSockets();
    await until(() => expect(auths).toHaveLength(2));
    await connected(c);

    expect(auths[1]).toEqual({ token: "token-2" });
    expect(reloads).toHaveBeenCalledTimes(1);
  });

  it("tries again with a new token after being refused", async () => {
    accept = (auth) => auth.token === "token-3";
    await connected(start());
    expect(auths).toEqual([{ token: "token-1" }, { token: "token-2" }, { token: "token-3" }]);
  });

  it("stops and asks for a login when the login has ended", async () => {
    tokenStatus = 401;
    const c = start();

    await until(() => expect(c.getStatus()).toBe("login-required"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(tokenCalls).toHaveLength(1);
  });

  it("keeps trying while the token request fails for another reason", async () => {
    tokenStatus = 500;
    const c = start();
    await until(() => expect(tokenCalls.length).toBeGreaterThan(2));
    expect(c.getStatus()).toBe("connecting");

    tokenStatus = 200;
    await connected(c);
  });

  it("can connect again after a new login", async () => {
    tokenStatus = 401;
    const c = start();
    await until(() => expect(c.getStatus()).toBe("login-required"));

    tokenStatus = 200;
    c.connect();
    await connected(c);
  });

  it("stays disconnected after disconnect(), and a new connect is not a reconnect", async () => {
    const c = start();
    const reloads = vi.fn();
    c.onReconnect(reloads);
    await connected(c);

    c.disconnect();
    expect(c.getStatus()).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(auths).toHaveLength(1);

    c.connect();
    await connected(c);
    expect(reloads).not.toHaveBeenCalled();
  });

  it("does not connect if stopped while the token is on its way", async () => {
    const c = start();
    c.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(auths).toEqual([]);
    expect(c.getStatus()).toBe("idle");
  });

  it("joins the live room without asking for a token", async () => {
    await connected(start({ mode: "live" }));
    expect(tokenCalls).toEqual([]);
    expect(auths).toEqual([{ live: true }]);
  });

  it("tells status listeners until they unsubscribe", async () => {
    const c = createSocketClient({ socketUrl: url, apiUrl: "x", fetch: fakeFetch });
    client = c;
    const seen: string[] = [];
    const stop = c.subscribeStatus(() => seen.push(c.getStatus()));
    c.connect();
    await connected(c);
    stop();
    c.disconnect();
    expect(seen).toEqual(["connecting", "connected"]);
  });
});
