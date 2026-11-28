// From a pretend ESP32 to pretend browsers, through the real app.
import type { HardwareWeightEvent } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import {
  connectDevice,
  deviceTokenEnv,
  TEST_DEVICE_TOKENS,
  waitFor,
  type TestDevice,
} from "../test/device-client";
import { testEnv } from "../test/env";
import { connectLive, socketToken, type LiveClient } from "../test/live-client";

const SETTINGS = {
  wakeThresholdKg: 500,
  stableWindowMs: 600,
  stableSpreadKg: 10,
  modelScaleKgPerG: 100,
};
const OFFLINE = { main: false, front: false, back: false };

let app: FastifyInstance;
let url: string;
let kiosk: LiveClient;
let live: LiveClient;
let store: LiveClient;
let supervisor: LiveClient;
let main: TestDevice;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const weights = (client: LiveClient) => client.named("hw:weight") as HardwareWeightEvent[];
const send = (kg: number, stable = true, pos = true) =>
  main.send({ t: "w", g: kg / 100, stable, pos: pos ? "ok" : "forward" });

beforeEach(async () => {
  app = await buildApp({ env: testEnv(deviceTokenEnv), hardware: { settings: SETTINGS } });
  url = await app.listen({ port: 0, host: "127.0.0.1" });
  await app.hardware.ready;
  kiosk = await connectLive(url, { token: socketToken(app, "KIOSK") });
  live = await connectLive(url, { live: true });
  store = await connectLive(url, { token: socketToken(app, "STORE") });
  supervisor = await connectLive(url, { token: socketToken(app, "SUPERVISOR", 1) });
  main = await connectDevice(url, TEST_DEVICE_TOKENS.main);
});
afterEach(async () => {
  [kiosk, live, store, supervisor].forEach((client) => client.socket.close());
  main.socket.terminate();
  await app.close();
});

describe("hw:weight", () => {
  it("carries the weight, the flags, canCapture with its reason, and the time", async () => {
    send(32_560, false, true);
    await waitFor(() => weights(kiosk).length === 1);

    const [event] = weights(kiosk);
    expect(event).toEqual({
      kg: 32_560,
      stable: false,
      positionOk: true,
      canCapture: false,
      reason: "NOT_STABLE",
      at: expect.any(String),
    });
    expect(new Date(event!.at).toISOString()).toBe(event!.at);
  });

  it("says canCapture once the weight has held still", async () => {
    for (let i = 0; i < 10; i++) {
      send(32_560);
      await sleep(100);
    }
    await waitFor(() => weights(kiosk).at(-1)?.canCapture === true);
    expect(weights(kiosk).at(-1)).toMatchObject({ kg: 32_560, reason: null });
  });

  it("is sent at most 5 times a second, ending with the newest weight", async () => {
    const started = performance.now();
    for (let i = 1; i <= 100; i++) {
      send(1000 + i);
      await sleep(10);
    }
    await waitFor(() => weights(kiosk).at(-1)?.kg === 1100);
    const seconds = (performance.now() - started) / 1000;

    // 100 readings in; about one message for every 200 ms out.
    expect(weights(kiosk).length).toBeLessThanOrEqual(Math.ceil(seconds * 5) + 1);
    expect(weights(kiosk).length).toBeGreaterThanOrEqual(4);
    const sentAt = weights(kiosk).map((w) => Date.parse(w.at));
    for (let i = 1; i < sentAt.length; i++) {
      // A few milliseconds of slack: timers and the clock do not agree exactly.
      expect(sentAt[i]! - sentAt[i - 1]!).toBeGreaterThanOrEqual(190);
    }
  });

  it("sends no leftover weight after the weighbridge goes offline", async () => {
    send(100);
    await waitFor(() => weights(kiosk).length === 1);
    send(200); // Held back by the throttle.
    main.socket.close();
    await waitFor(() => kiosk.named("hw:status").length >= 3);
    await sleep(300);

    expect(weights(kiosk).map((w) => w.kg)).toEqual([100]);
  });
});

describe("who receives the hardware events", () => {
  it("gives the live room hw:status but nothing that is for the kiosk only", async () => {
    send(32_560);
    await waitFor(() => kiosk.named("truck:arrived").length === 1);
    send(0);
    await waitFor(() => kiosk.named("truck:left").length === 1);
    main.socket.close();
    await waitFor(() => live.named("hw:status").at(-1) !== undefined);
    await waitFor(() => (live.named("hw:status").at(-1) as { main: boolean }).main === false);

    expect(new Set(live.events.map(([name]) => name))).toEqual(new Set(["hw:status"]));
    expect(kiosk.named("hw:weight").length).toBeGreaterThan(0);
    expect(kiosk.named("truck:arrived")).toEqual([{ kg: 32_560, at: expect.any(String) }]);
    expect(kiosk.named("truck:left")).toEqual([{ kg: 0, at: expect.any(String) }]);
  });

  it("gives the store officer and supervisors no hardware events", async () => {
    send(32_560);
    await waitFor(() => kiosk.named("truck:arrived").length === 1);
    await sleep(100);

    // The store officer hears of a fault (and, on connecting, that there is none), and of
    // nothing else about the hardware.
    expect(store.events.map(([name]) => name)).not.toContain("hw:weight");
    expect(store.named("hw:fault")).toEqual([{ fault: null }]);
    expect(store.events).toHaveLength(1);
    expect(supervisor.events).toEqual([]);
  });
});

describe("hw:status", () => {
  const latest = (client: LiveClient) => client.named("hw:status").at(-1);

  it("is sent to a screen as soon as it connects", async () => {
    // These two connected before any board sent a message.
    await waitFor(() => live.named("hw:status").length > 0);
    expect(live.named("hw:status")[0]).toEqual(OFFLINE);
    expect(kiosk.named("hw:status")[0]).toEqual(OFFLINE);

    send(0);
    await waitFor(() => (latest(live) as { main: boolean }).main);
    const late = await connectLive(url, { live: true });
    await waitFor(() => late.named("hw:status").length === 1);
    expect(late.named("hw:status")).toEqual([{ ...OFFLINE, main: true }]);
    expect(late.events).toHaveLength(1);
    late.socket.close();
  });

  it("follows each board online and offline", async () => {
    send(0);
    app.hardware.listener.cameraFrame("back", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await waitFor(() => {
      const now = latest(kiosk) as typeof OFFLINE | undefined;
      return !!now?.main && now.back;
    });
    expect(latest(kiosk)).toEqual({ main: true, front: false, back: true });

    app.hardware.state.disconnected("back");
    main.socket.close();
    await waitFor(() => JSON.stringify(latest(live)) === JSON.stringify(OFFLINE));
  });
});
