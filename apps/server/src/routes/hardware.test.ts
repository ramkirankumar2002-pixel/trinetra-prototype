// The whole app with pretend devices on real WebSocket connections.
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppOptions } from "../app";
import { createDb } from "../db/client";
import { seedDatabase } from "../db/seed";
import { SESSION_COOKIE } from "../plugins/security";
import { resetTestDatabase } from "../test/database";
import {
  connectDevice,
  deviceTokenEnv,
  TEST_DEVICE_TOKENS,
  waitFor,
  type TestDevice,
} from "../test/device-client";
import { testDatabaseUrl, testEnv } from "../test/env";

const SETTINGS = {
  wakeThresholdKg: 500,
  stableWindowMs: 600,
  stableSpreadKg: 10,
  modelScaleKgPerG: 100,
};

let app: FastifyInstance;
let url: string;
const devices: TestDevice[] = [];
const feeds: NodeJS.Timeout[] = [];

async function start(hardware: AppOptions["hardware"] = { settings: SETTINGS }) {
  app = await buildApp({ env: testEnv(deviceTokenEnv), hardware });
  url = await app.listen({ port: 0, host: "127.0.0.1" });
  await app.hardware.ready;
}

beforeEach(() => start());
afterEach(async () => {
  feeds.splice(0).forEach(clearInterval);
  devices.splice(0).forEach((device) => device.socket.terminate());
  await app.close();
});

async function connectMain() {
  const device = await connectDevice(url, TEST_DEVICE_TOKENS.main);
  devices.push(device);
  return device;
}

/** Sends the same weight every 100 ms until the test ends or it is changed. */
function feed(device: TestDevice, weight: { g: number; stable: boolean; pos: string }) {
  const current = { ...weight };
  feeds.push(
    setInterval(() => {
      if (device.socket.readyState === device.socket.OPEN) device.send({ t: "w", ...current });
    }, 100),
  );
  return current;
}

const session = (role: "KIOSK" | "SUPERVISOR" | "STORE") => ({
  [SESSION_COOKIE]: app.jwt.sign({ userId: 1, role, name: "Test", use: "session" }),
});

const kioskState = async () =>
  (await app.inject({ method: "GET", url: "/api/kiosk/state", cookies: session("KIOSK") })).json();

describe("GET /api/kiosk/state", () => {
  it("is for the kiosk only", async () => {
    const get = (cookies?: Record<string, string>) =>
      app.inject({ method: "GET", url: "/api/kiosk/state", ...(cookies ? { cookies } : {}) });

    expect((await get()).statusCode).toBe(401);
    expect((await get(session("STORE"))).statusCode).toBe(403);
    expect((await get(session("SUPERVISOR"))).statusCode).toBe(403);
    const response = await get(session("KIOSK"));
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("allows more requests than the general limit", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/kiosk/state",
      cookies: session("KIOSK"),
    });
    expect(response.headers["x-ratelimit-limit"]).toBe("1200");
  });

  const never = { online: false, lastSeenAt: null };

  it("shows everything offline at first", async () => {
    expect(await kioskState()).toEqual({
      weight: null,
      devices: { main: never, front: never, back: never },
      fault: null,
      canCapture: { ok: false, reason: "DEVICE_OFFLINE" },
    });
  });

  it("blocks every capture when the weighbridge goes offline", async () => {
    const main = await connectMain();
    feed(main, { g: 325.6, stable: true, pos: "ok" });
    await expect
      .poll(async () => (await kioskState()).canCapture, { timeout: 3000 })
      .toEqual({ ok: true, reason: null });

    main.socket.close();
    await expect
      .poll(async () => (await kioskState()).canCapture)
      .toEqual({ ok: false, reason: "DEVICE_OFFLINE" });
    expect(app.hardware.state.canCapture()).not.toHaveProperty("kg");
  });

  it("shows a new weight within half a second", async () => {
    const main = await connectMain();
    main.send({ t: "w", g: 120, stable: false, pos: "ok" });
    await expect.poll(async () => (await kioskState()).weight?.kg, { timeout: 500 }).toBe(12_000);

    main.send({ t: "w", g: 325.6, stable: false, pos: "ok" });
    await expect.poll(async () => (await kioskState()).weight?.kg, { timeout: 500 }).toBe(32_560);
  });

  it("allows a capture only once the weight has settled with the position OK", async () => {
    const main = await connectMain();
    const weight = feed(main, { g: 325.6, stable: true, pos: "forward" });
    const check = async () => (await kioskState()).canCapture;

    await expect.poll(check).toEqual({ ok: false, reason: "POSITION_NOT_OK" });
    weight.pos = "back";
    await expect.poll(check).toEqual({ ok: false, reason: "POSITION_NOT_OK" });
    weight.pos = "ok";
    weight.stable = false;
    await expect.poll(check).toEqual({ ok: false, reason: "NOT_STABLE" });
    weight.stable = true;
    await expect.poll(check, { timeout: 3000 }).toEqual({ ok: true, reason: null });
  });

  it("detects that the ESP32 went offline", async () => {
    const main = await connectMain();
    main.send({ t: "hb" });
    await expect.poll(async () => (await kioskState()).devices.main.online).toBe(true);

    main.socket.close();
    await expect.poll(async () => (await kioskState()).devices.main.online).toBe(false);
  });

  it("reports each camera from its own frames, with when it was last seen", async () => {
    await app.inject({
      method: "POST",
      url: "/api/cam/back",
      headers: { "content-type": "image/jpeg", "x-device-token": TEST_DEVICE_TOKENS.back },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });

    const { devices } = await kioskState();
    expect(devices.back).toEqual({ online: true, lastSeenAt: expect.any(String) });
    expect(devices.front).toEqual(never);
  });
});

describe("events and commands over the connection", () => {
  it("emits truck:arrived and truck:left", async () => {
    const seen: string[] = [];
    app.hardware.bus.on("truck:arrived", () => seen.push("arrived"));
    app.hardware.bus.on("truck:left", () => seen.push("left"));
    const main = await connectMain();

    main.send({ t: "w", g: 325.6, stable: false, pos: "ok" });
    main.send({ t: "w", g: 0, stable: true, pos: "ok" });
    await waitFor(() => seen.length === 2);
    expect(seen).toEqual(["arrived", "left"]);
  });

  it("sends light, buzzer, display and tare commands to the main ESP32", async () => {
    const main = await connectMain();
    const { commands, state } = app.hardware;
    main.send({ t: "w", g: 0.03, stable: true, pos: "ok" });
    await waitFor(() => state.isOnline("main"));
    // On coming online it is told to show "ready" first.
    await waitFor(() => main.received.length === 2);
    expect(main.received.splice(0)).toEqual([
      { t: "light", entry: "G", exit: "R", blink: false },
      { t: "display", lines: ["TRINETRA READY", "DRIVE ON", "Entry is green"] },
    ]);

    expect(commands.setLights({ entry: "Y", exit: "off", blink: true })).toEqual({ sent: true });
    expect(commands.buzz(120, 2)).toEqual({ sent: true });
    expect(commands.showLines(["Unload at", "CH-6"])).toEqual({ sent: true });
    expect(commands.tare()).toEqual({ sent: true });
    await waitFor(() => main.received.length === 4);

    expect(main.received).toEqual([
      { t: "light", entry: "Y", exit: "off", blink: true },
      { t: "buzz", ms: 120, times: 2, gap: 120 },
      { t: "display", lines: ["Unload at", "CH-6"] },
      { t: "tare" },
    ]);
  });

  it("refuses commands while the ESP32 is offline", () => {
    const { commands } = app.hardware;
    const offline = { sent: false, reason: "DEVICE_OFFLINE" };
    expect(commands.setLights({ entry: "G", exit: "R" })).toEqual(offline);
    expect(commands.buzz(100)).toEqual(offline);
    expect(commands.showLines(["Hello"])).toEqual(offline);
    expect(commands.tare()).toEqual(offline);
  });

  it.each([500, 501, 32_560])("refuses to tare with %i kg on the bridge", async (kg) => {
    const main = await connectMain();
    main.send({ t: "w", g: kg / 100, stable: true, pos: "ok" });
    await waitFor(() => app.hardware.state.currentReading()?.kg === kg);

    expect(app.hardware.commands.tare()).toEqual({ sent: false, reason: "BRIDGE_NOT_EMPTY" });
    // Anything wrongly sent would arrive before this marker.
    app.hardware.commands.showLines(["marker"]);
    await waitFor(() => main.received.some((command) => String(command.lines) === "marker"));
    expect(main.received.filter((command) => command.t === "tare")).toEqual([]);
  });

  it("refuses to tare without a fresh weight", async () => {
    const main = await connectMain();
    main.send({ t: "hb" });
    await waitFor(() => app.hardware.state.isOnline("main"));

    expect(app.hardware.commands.tare()).toEqual({ sent: false, reason: "STALE_READING" });
  });

  it("rejects wrong command values", () => {
    const { commands } = app.hardware;
    expect(() => commands.setLights({ entry: "B" as never, exit: "R" })).toThrow();
    expect(() => commands.buzz(0)).toThrow();
    expect(() => commands.buzz(60_000)).toThrow();
    expect(() => commands.buzz(100, 99)).toThrow();
    expect(() => commands.showLines([])).toThrow();
    expect(() => commands.showLines(["a", "b", "c", "d"])).toThrow();
    expect(() => commands.showLines(["x".repeat(22)])).toThrow();
  });
});

describe("weighbridge settings", () => {
  it.skipIf(!testDatabaseUrl)(
    "are read from the database",
    async () => {
      await resetTestDatabase(testDatabaseUrl!);
      const { db, close } = createDb(testDatabaseUrl!, { max: 1 });
      await seedDatabase(db);
      await close();
      await app.close();
      await start({});

      const main = await connectMain();
      main.send({ t: "w", g: 99, stable: true, pos: "ok" });
      // 99 g is 9,900 kg at the seeded scale, under the seeded 100 g threshold.
      await expect.poll(async () => (await kioskState()).weight?.kg).toBe(9900);
      expect((await kioskState()).canCapture.reason).toBe("NO_TRUCK");
      main.send({ t: "w", g: 101, stable: true, pos: "ok" });
      await expect.poll(async () => (await kioskState()).canCapture.reason).toBe("NOT_STABLE");
    },
    60_000,
  );

  it("block every capture while they cannot be read", async () => {
    await app.close();
    await start({ loadSettings: () => Promise.reject(new Error("database is down")) });

    const main = await connectMain();
    main.send({ t: "w", g: 325.6, stable: true, pos: "ok" });
    await waitFor(() => app.hardware.state.isOnline("main"));

    expect((await kioskState()).canCapture).toEqual({ ok: false, reason: "SETTINGS_NOT_LOADED" });
    expect(app.hardware.commands.tare()).toEqual({ sent: false, reason: "SETTINGS_NOT_LOADED" });
  });
});
