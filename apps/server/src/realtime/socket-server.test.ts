// Authentication and rooms, with real Socket.IO clients. No database is needed.
import { supervisorRoom, type Room } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { SESSION_COOKIE } from "../plugins/security";
import { connectDevice, deviceTokenEnv, TEST_DEVICE_TOKENS, waitFor } from "../test/device-client";
import { testEnv } from "../test/env";
import { connectLive, socketToken, type LiveClient } from "../test/live-client";

const SETTINGS = {
  wakeThresholdKg: 500,
  stableWindowMs: 3000,
  stableSpreadKg: 10,
  modelScaleKgPerG: 100,
};

let app: FastifyInstance;
let url: string;
const logLines: string[] = [];
const clients: LiveClient[] = [];

beforeAll(async () => {
  app = await buildApp({
    env: testEnv(deviceTokenEnv),
    hardware: { settings: SETTINGS },
    logger: { write: (line) => void logLines.push(line) },
  });
  url = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterEach(async () => {
  clients.splice(0).forEach((client) => client.socket.close());
  await waitFor(() => app.realtime.io.sockets.sockets.size === 0);
});
afterAll(() => app.close());

async function connect(auth: Record<string, unknown>, origin?: string) {
  const client = await connectLive(url, auth, origin);
  clients.push(client);
  return client;
}
const asUser = (role: "KIOSK" | "SUPERVISOR" | "STORE", userId = 1) =>
  connect({ token: socketToken(app, role, userId) });

/** The rooms the server has put a connection in, apart from its private one. */
const roomsOf = (client: LiveClient) =>
  [...app.realtime.io.sockets.sockets.get(client.socket.id!)!.rooms].filter(
    (room) => room !== client.socket.id,
  );

const refusal = (auth: Record<string, unknown>) =>
  connectLive(url, auth).then(
    (client) => {
      clients.push(client);
      return "connected";
    },
    (error: Error) => error.message,
  );

const seconds = () => Math.floor(Date.now() / 1000);
const aTicket = { ticketId: 7, status: "READY_FOR_SECOND" } as const;

describe("authentication", () => {
  it.each([
    ["no token", {}],
    ["live: false", { live: false }],
    ["live as text", { live: "true" }],
  ])("refuses %s", async (_label, auth) => {
    expect(await refusal(auth)).toBe("TOKEN_REQUIRED");
  });

  it.each([
    ["text that is not a token", { token: "nonsense" }],
    ["an empty token", { token: "" }],
    ["a number", { token: 5 }],
    ["a bad token beside live: true", { token: "nonsense", live: true }],
  ])("refuses %s", async (_label, auth) => {
    expect(await refusal(auth)).toBe("INVALID_TOKEN");
  });

  it("refuses a token signed with another secret", async () => {
    const other = await buildApp({
      env: testEnv({ JWT_SECRET: "a-completely-different-secret-12345678" }),
      hardware: { settings: SETTINGS },
    });
    await other.ready();
    const token = socketToken(other, "KIOSK");
    await other.close();

    expect(await refusal({ token })).toBe("INVALID_TOKEN");
  });

  it("refuses an expired token", async () => {
    const token = app.jwt.sign({
      userId: 1,
      role: "KIOSK",
      name: "Old",
      use: "socket",
      iat: seconds() - 120,
      exp: seconds() - 60,
    } as never);

    expect(await refusal({ token })).toBe("INVALID_TOKEN");
  });

  it("refuses a login cookie used as a socket token", async () => {
    const token = app.jwt.sign({ userId: 1, role: "KIOSK", name: "Kiosk", use: "session" });
    expect(await refusal({ token })).toBe("INVALID_TOKEN");
  });

  it("accepts the token that GET /api/auth/socket-token gives", async () => {
    const cookie = app.jwt.sign(
      { userId: 1, role: "KIOSK", name: "WB-01", use: "session" },
      { expiresIn: 3600 },
    );
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/socket-token",
      cookies: { [SESSION_COOKIE]: cookie },
    });
    const client = await connect({ token: response.json().token });

    expect(roomsOf(client)).toEqual(["kiosk"]);
    // The connection knows when the login ends.
    expect(app.jwt.decode<{ sessionEndsAt: number }>(response.json().token)!.sessionEndsAt).toBe(
      app.jwt.decode<{ exp: number }>(cookie)!.exp,
    );
  });

  it("ends the connection when the login expires", async () => {
    const token = app.jwt.sign(
      { userId: 1, role: "KIOSK", name: "WB-01", use: "socket", sessionEndsAt: seconds() + 1 },
      { expiresIn: 60 },
    );
    const client = await connect({ token });

    await waitFor(() => client.socket.disconnected, 3000);
  });

  it("allows only the website's origin", async () => {
    const token = () => ({ token: socketToken(app, "KIOSK") });
    await expect(connect(token(), "http://localhost:3000")).resolves.toBeDefined();
    await expect(connect(token(), "https://evil.example")).rejects.toThrow();
    await expect(connect({ live: true }, "https://evil.example")).rejects.toThrow();
  });

  it("sends CORS headers for the website only", async () => {
    const handshake = (origin: string) =>
      fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin } });

    const ours = await handshake("http://localhost:3000");
    expect(ours.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(ours.headers.get("access-control-allow-credentials")).toBe("true");
    const theirs = await handshake("https://evil.example");
    expect(theirs.status).toBe(403);
    expect(theirs.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("rooms", () => {
  it.each([
    ["KIOSK", 12, "kiosk"],
    ["STORE", 11, "store"],
    ["SUPERVISOR", 1, "supervisor:1"],
    ["SUPERVISOR", 3, "supervisor:3"],
  ] as const)("puts %s %i only in %s", async (role, userId, room) => {
    expect(roomsOf(await asUser(role, userId))).toEqual([room]);
  });

  it("puts a connection without a login only in live", async () => {
    expect(roomsOf(await connect({ live: true }))).toEqual(["live"]);
  });

  it("ignores a browser that asks for a room", async () => {
    const client = await connect({
      token: socketToken(app, "SUPERVISOR", 2),
      room: "store",
      rooms: ["kiosk"],
    });
    for (const event of ["join", "subscribe", "room"]) {
      (client.socket as { emit: (...args: unknown[]) => void }).emit(event, "store");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(roomsOf(client)).toEqual(["supervisor:2"]);
  });

  it("never gives a supervisor another supervisor's event", async () => {
    const amit = await asUser("SUPERVISOR", 1);
    const suresh = await asUser("SUPERVISOR", 2);
    const ten = await asUser("SUPERVISOR", 10);

    app.realtime.publish("approval:new", [supervisorRoom(1)], {
      approvalId: 5,
      ticketId: 7,
      kind: "SUPERVISOR",
    });
    // A later event to everyone shows the earlier one has had time to arrive.
    app.realtime.publish("ticket:updated", [1, 2, 10].map(supervisorRoom), aTicket);
    await waitFor(() => [amit, suresh, ten].every((c) => c.named("ticket:updated").length === 1));

    expect(amit.named("approval:new")).toHaveLength(1);
    expect(suresh.named("approval:new")).toEqual([]);
    // "supervisor:1" is not a prefix match for supervisor 10.
    expect(ten.named("approval:new")).toEqual([]);
  });

  it("delivers to each room only what was sent to it", async () => {
    const kiosk = await asUser("KIOSK");
    const store = await asUser("STORE");
    const live = await connect({ live: true });

    app.realtime.publish("approval:new", ["store"], {
      approvalId: 1,
      ticketId: null,
      kind: "DRIVER_HELP",
    });
    app.realtime.publish("ticket:updated", ["kiosk", "store", "live"], aTicket);
    await waitFor(() => [kiosk, store, live].every((c) => c.named("ticket:updated").length === 1));

    expect(store.named("approval:new")).toHaveLength(1);
    expect(kiosk.named("approval:new")).toEqual([]);
    expect(live.named("approval:new")).toEqual([]);
  });

  it("sends an event once to a connection even if listed in two ways", async () => {
    const kiosk = await asUser("KIOSK");
    app.realtime.publish("ticket:updated", ["kiosk", "kiosk"], aTicket);
    app.realtime.publish("kiosk:ready", ["kiosk"], { ticketId: 7, ticketNo: "x", plate: "y" });
    await waitFor(() => kiosk.named("kiosk:ready").length === 1);
    expect(kiosk.named("ticket:updated")).toHaveLength(1);
  });

  it("refuses to publish to no room, which would reach everyone", () => {
    expect(() => app.realtime.publish("ticket:updated", [], aTicket)).toThrow(/no room/);
  });

  it.each([
    ["hw:weight", "live"],
    ["truck:arrived", "live"],
    ["approval:new", "live"],
    ["approval:new", "kiosk"],
    ["kiosk:ready", "store"],
    ["invoice:read", "supervisor:1"],
    ["hw:weight", "store"],
  ] as const)("refuses to publish %s to %s", (event, room) => {
    expect(() => app.realtime.publish(event, [room as Room], {} as never)).toThrow(
      /must not be sent/,
    );
  });

  it("rejects a user id that would make a wrong room", () => {
    for (const id of [0, -1, 1.5, Number.NaN, undefined as unknown as number]) {
      expect(() => supervisorRoom(id)).toThrow(RangeError);
    }
  });
});

describe("sharing the port with the devices", () => {
  it("serves /device and Socket.IO at the same time", async () => {
    const device = await connectDevice(url, TEST_DEVICE_TOKENS.main);
    const browser = await asUser("KIOSK");
    // Past engine.io's one second wait for unclaimed upgrade requests.
    await new Promise((resolve) => setTimeout(resolve, 1300));

    expect(device.socket.readyState).toBe(device.socket.OPEN);
    expect(browser.socket.connected).toBe(true);
    app.hardware.commands.setLights({ entry: "G", exit: "R" });
    app.hardware.hub.send("main", { t: "light", entry: "R", exit: "R", blink: false });
    await waitFor(() => device.received.length > 0);
    device.socket.close();
    await device.closed;
  });
});

describe("logging", () => {
  it("records who connects and disconnects, never the token", async () => {
    logLines.length = 0;
    const token = socketToken(app, "STORE", 11);
    const client = await connect({ token });
    client.socket.close();
    await waitFor(() => logLines.some((line) => line.includes("live connection closed")));
    await refusal({ token: `${token}x` });
    await waitFor(() => logLines.some((line) => line.includes("refused a live connection")));

    const log = logLines.join("");
    expect(log).toContain('"role":"STORE","userId":11,"user":"Test STORE"');
    expect(log).toContain("live connection opened");
    expect(log).not.toContain(token);
    expect(log).not.toContain(token.split(".")[2]);
  });
});
