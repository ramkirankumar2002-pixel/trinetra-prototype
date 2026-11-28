import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DeviceHub } from "../hardware/hub";
import { loggerOptions } from "../logger";
import {
  connectDevice,
  deviceTokenEnv,
  TEST_DEVICE_TOKENS,
  waitFor,
  type TestDevice,
} from "../test/device-client";
import { testEnv } from "../test/env";
import { DEVICE_SOCKET_OPTIONS, registerDeviceSocket } from "./device-socket";

let app: FastifyInstance;
let url: string;
const hub = new DeviceHub();
const events: unknown[][] = [];
const logLines: string[] = [];
const devices: TestDevice[] = [];

beforeAll(async () => {
  app = Fastify({ logger: loggerOptions({ write: (line) => void logLines.push(line) }) });
  await app.register(websocket, DEVICE_SOCKET_OPTIONS);
  registerDeviceSocket(app, {
    env: testEnv(deviceTokenEnv),
    hub,
    listener: {
      mainMessage: (message) => void events.push(["main", message]),
      disconnected: (device) => void events.push(["disconnected", device]),
    },
  });
  url = await app.listen({ port: 0, host: "127.0.0.1" });
});
beforeEach(() => {
  events.length = 0;
  logLines.length = 0;
});
afterEach(async () => {
  for (const device of devices.splice(0)) {
    device.socket.close();
    await device.closed;
  }
  // The server hears of a close slightly later; do not let it leak into the next test.
  await waitFor(() => (["main", "front", "back"] as const).every((d) => !hub.isConnected(d)));
});
afterAll(() => app.close());

async function connect(token?: string) {
  const device = await connectDevice(url, token);
  devices.push(device);
  return device;
}
const messages = () => events.filter(([from]) => from !== "disconnected");
const weight = { t: "w", g: 325.6, stable: true, pos: "ok" };

describe("device authentication", () => {
  it("accepts the main ESP32's token", async () => {
    const device = await connect(TEST_DEVICE_TOKENS.main);
    await waitFor(() => hub.send("main", { t: "tare" }));
    await waitFor(() => device.received.length > 0);
    expect(device.socket.readyState).toBe(device.socket.OPEN);
  });

  it.each(["front", "back"] as const)(
    "refuses the %s camera: it sends frames, not weights",
    async (name) => {
      const camera = await connect(TEST_DEVICE_TOKENS[name]);
      camera.send(weight);

      expect((await camera.closed).code).toBe(1008);
      expect(events).toEqual([]);
    },
  );

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["a wrong token", "not-the-right-token-at-all"],
    ["part of the right token", TEST_DEVICE_TOKENS.main.slice(0, -1)],
  ])("closes a connection with %s immediately", async (_label, token) => {
    const device = await connect(token);
    // Sent right away: it must never be read.
    device.send(weight);

    expect(await device.closed).toMatchObject({ code: 1008 });
    expect(events).toEqual([]);
  });

  it("replaces the old connection with a new one, and ignores the old one", async () => {
    const first = await connect(TEST_DEVICE_TOKENS.main);
    first.send(weight);
    await waitFor(() => messages().length === 1);

    events.length = 0;
    const second = await connect(TEST_DEVICE_TOKENS.main);
    expect(await first.closed).toEqual({ code: 4000, reason: "replaced by a new connection" });

    second.send({ ...weight, g: 1 });
    await waitFor(() => messages().length === 1);
    expect(messages()).toEqual([["main", { ...weight, g: 1 }]]);
    // The old connection closing must not report the new one as gone.
    expect(events.filter(([from]) => from === "disconnected")).toHaveLength(1);
    expect(hub.send("main", { t: "tare" })).toBe(true);
    await waitFor(() => second.received.length === 1);
  });

  it("keeps the weighbridge connected when a camera's token is tried", async () => {
    const main = await connect(TEST_DEVICE_TOKENS.main);
    await (
      await connect(TEST_DEVICE_TOKENS.front)
    ).closed;
    expect(main.socket.readyState).toBe(main.socket.OPEN);
  });

  it("reports a disconnect, after which nothing can be sent", async () => {
    const device = await connect(TEST_DEVICE_TOKENS.main);
    events.length = 0;
    device.socket.close();
    await waitFor(() => events.length === 1);

    expect(events).toEqual([["disconnected", "main"]]);
    expect(hub.send("main", { t: "tare" })).toBe(false);
  });

  it("never writes a device token to the log", async () => {
    await connect("a-wrong-token-that-was-sent");
    await connect(TEST_DEVICE_TOKENS.main);
    app.log.info({ headers: { "x-device-token": TEST_DEVICE_TOKENS.main } }, "headers");

    await waitFor(() => logLines.length > 2);
    expect(logLines.join("")).not.toContain(TEST_DEVICE_TOKENS.main);
    expect(logLines.join("")).not.toContain("a-wrong-token-that-was-sent");
  });
});

describe("message validation", () => {
  it("passes on weights and heartbeats from the main ESP32", async () => {
    const device = await connect(TEST_DEVICE_TOKENS.main);
    device.send({ ...weight, g: -4.5 });
    device.send({ t: "hb" });
    await waitFor(() => messages().length === 2);

    expect(messages()).toEqual([
      ["main", { ...weight, g: -4.5 }],
      ["main", { t: "hb" }],
    ]);
  });

  it.each([
    { t: "w", g: 200, stable: false, pos: "forward" },
    { t: "w", g: 200, stable: false, pos: "back" },
    { t: "tamper", reason: "HX711 NO DATA" },
    { t: "tamper", reason: "CELL WIRE OPEN" },
    { t: "tamper", reason: "HX711 STUCK" },
    { t: "tamper", reason: "CELL WIRE FAULT" },
    { t: "tamper_clear" },
  ])("passes on %j", async (message) => {
    const device = await connect(TEST_DEVICE_TOKENS.main);
    device.send(message);
    await waitFor(() => messages().length === 1);
    expect(messages()).toEqual([["main", message]]);
  });

  it.each([
    ["not JSON", "weight=5"],
    ["an array", "[1,2]"],
    ["null", "null"],
    ["an unknown type", { t: "boom" }],
    ["a missing field", { t: "w", g: 5, stable: true }],
    ["a weight as text", { ...weight, g: "325.6" }],
    ["a weight in kilograms, the old way", { t: "w", kg: 32_560, stable: true, pos: true }],
    ["a flag as text", { ...weight, stable: "yes" }],
    ["an unknown position", { ...weight, pos: "sideways" }],
    ["an impossible weight", { ...weight, g: 10_000_000 }],
    ["an unknown tamper reason", { t: "tamper", reason: "COFFEE SPILT" }],
    ["a camera greeting", { t: "hello", cam: "front" }],
  ])("ignores %s and keeps the connection", async (_label, message) => {
    const device = await connect(TEST_DEVICE_TOKENS.main);
    device.send(message);
    device.send({ t: "hb" });
    await waitFor(() => messages().length === 1);

    expect(messages()).toEqual([["main", { t: "hb" }]]);
    expect(logLines.join("")).toContain("ignored a bad message");
  });

  it("ignores binary data", async () => {
    const device = await connect(TEST_DEVICE_TOKENS.main);
    device.socket.send(Buffer.from(JSON.stringify(weight)), { binary: true });
    device.send({ t: "hb" });
    await waitFor(() => messages().length === 1);
    expect(messages()).toEqual([["main", { t: "hb" }]]);
  });

  it("logs a flood of bad messages only once", async () => {
    const device = await connect(TEST_DEVICE_TOKENS.main);
    for (let i = 0; i < 50; i++) device.send("rubbish");
    device.send({ t: "hb" });
    await waitFor(() => messages().length === 1);

    expect(logLines.filter((line) => line.includes("ignored a bad message"))).toHaveLength(1);
  });

  it("closes a connection that sends a very large message", async () => {
    const device = await connect(TEST_DEVICE_TOKENS.main);
    device.send("x".repeat(10_000));
    expect((await device.closed).code).toBe(1009);
  });
});
