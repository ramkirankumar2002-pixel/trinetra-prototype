// The hardware state with a clock the test controls.
import type { DeviceId } from "@trinetra/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createHardwareBus } from "./events";
import { HardwareState, type HardwareSettings } from "./state";

const SETTINGS: HardwareSettings = {
  wakeThresholdKg: 500,
  stableWindowMs: 3000,
  stableSpreadKg: 10,
  modelScaleKgPerG: 100,
};

let time: number;
let settings: HardwareSettings | undefined;
let state: HardwareState;
let events: [string, object][];

beforeEach(() => {
  time = 100_000;
  settings = SETTINGS;
  events = [];
  const bus = createHardwareBus();
  for (const name of [
    "hw:weight",
    "hw:status",
    "hw:fault",
    "truck:arrived",
    "truck:left",
  ] as const) {
    bus.on(name, (data: object) => events.push([name, data]));
  }
  state = new HardwareState(
    bus,
    () => settings,
    () => time,
  );
});

const pass = (ms: number) => void (time += ms);
const send = (kg = 32_560, stable = true, pos = true) => state.addWeight({ kg, stable, pos });

/** Sends a reading every 200 ms for `ms`, including one at the start and the end. */
function hold(ms: number, kg = 32_560, stable = true, pos = true) {
  send(kg, stable, pos);
  for (let sent = 200; sent <= ms; sent += 200) {
    pass(200);
    send(kg, stable, pos);
  }
}

const named = (name: string) => events.filter(([event]) => event === name).map(([, data]) => data);
const reason = () => state.canCapture().reason;

describe("a weighbridge fault", () => {
  const faults = () => named("hw:fault");

  beforeEach(() => hold(3000));

  it("blocks every capture, and the plate reading too", () => {
    state.setFault("CELL WIRE OPEN");
    expect(reason()).toBe("WEIGHBRIDGE_FAULT");
    expect(state.truckCheck()).toEqual({ ok: false, reason: "WEIGHBRIDGE_FAULT" });
    expect(state.snapshot().fault).toEqual({
      reason: "CELL WIRE OPEN",
      since: expect.any(String),
    });
    expect(state.snapshot().weight).toBeNull();
  });

  it("is announced once, however often the ESP32 repeats it", () => {
    state.setFault("HX711 STUCK");
    state.setFault("HX711 STUCK");
    state.setFault("HX711 STUCK");
    expect(faults()).toEqual([
      { fault: { reason: "HX711 STUCK", since: expect.any(String) }, reason: "HX711 STUCK" },
    ]);
  });

  it("keeps its start time when only the reason changes", () => {
    state.setFault("HX711 STUCK");
    const since = state.fault!.since;
    state.setFault("HX711 NO DATA");
    expect(state.fault).toEqual({ reason: "HX711 NO DATA", since });
  });

  it("stays when the ESP32 is unplugged", () => {
    state.setFault("CELL WIRE FAULT");
    state.disconnected("main");
    expect(reason()).toBe("WEIGHBRIDGE_FAULT");
  });

  it("ends with the cleared message, and the weight must be still all over again", () => {
    state.setFault("CELL WIRE OPEN");
    state.setFault(null);
    expect(faults().at(-1)).toEqual({ fault: null, reason: "CELL WIRE OPEN" });
    send();
    expect(reason()).toBe("NOT_STABLE");
    pass(200);
    hold(2800);
    expect(state.canCapture().ok).toBe(true);
  });

  it("says nothing when there was no fault to clear", () => {
    state.setFault(null);
    expect(faults()).toEqual([]);
    expect(state.canCapture().ok).toBe(true);
  });
});

describe("canCapture", () => {
  it("gives the average of the still readings, not just the last one", () => {
    // A noisy load cell: every reading is within the band of the newest one.
    for (let i = 0; i <= 15; i++) {
      send(i % 2 === 0 ? 32_556 : 32_564);
      pass(200);
    }
    send(32_564);
    const decision = state.canCapture();
    expect(decision).toMatchObject({ ok: true });
    expect(decision).not.toMatchObject({ kg: 32_564 });
    expect((decision as { kg: number }).kg).toBeGreaterThan(32_558);
    expect((decision as { kg: number }).kg).toBeLessThan(32_562);
  });

  it("is true after the weight holds still for 3 seconds, and gives that weight", () => {
    hold(3000);
    expect(state.canCapture()).toEqual({ ok: true, reason: null, kg: 32_560 });
  });

  it("SETTINGS_NOT_LOADED while the settings are unknown", () => {
    settings = undefined;
    hold(3000);
    expect(reason()).toBe("SETTINGS_NOT_LOADED");
  });

  it("DEVICE_OFFLINE before the ESP32 has sent anything", () => {
    expect(reason()).toBe("DEVICE_OFFLINE");
  });

  it("DEVICE_OFFLINE after 3 seconds of silence, even before a timer tick", () => {
    hold(3000);
    pass(3001);
    expect(reason()).toBe("DEVICE_OFFLINE");
  });

  it("DEVICE_OFFLINE after a disconnect", () => {
    hold(3000);
    state.disconnected("main");
    expect(reason()).toBe("DEVICE_OFFLINE");
  });

  it("STALE_READING when the newest weight is 1 second old", () => {
    hold(3000);
    pass(999);
    expect(state.canCapture().ok).toBe(true);
    pass(1);
    expect(reason()).toBe("STALE_READING");
  });

  it("STALE_READING when only heartbeats arrive", () => {
    state.seen("main");
    expect(reason()).toBe("STALE_READING");

    hold(3000);
    pass(1500);
    state.seen("main");
    expect(reason()).toBe("STALE_READING");
  });

  it.each([0, 499, 500, -20])("NO_TRUCK at %i kg (threshold 500)", (kg) => {
    hold(3000, kg);
    expect(reason()).toBe("NO_TRUCK");
  });

  it("accepts a weight just above the threshold", () => {
    hold(3000, 501);
    expect(state.canCapture().ok).toBe(true);
  });

  it("POSITION_NOT_OK while the truck is not fully on the bridge", () => {
    hold(3000, 32_560, true, false);
    expect(reason()).toBe("POSITION_NOT_OK");
    pass(200);
    send();
    expect(state.canCapture().ok).toBe(true);
  });

  it("NOT_STABLE before 3 seconds have passed", () => {
    hold(2800);
    expect(reason()).toBe("NOT_STABLE");
    pass(200);
    send();
    expect(state.canCapture().ok).toBe(true);
  });

  it("NOT_STABLE while the ESP32 flag is off", () => {
    hold(3000, 32_560, false);
    expect(reason()).toBe("NOT_STABLE");
  });

  it("NOT_STABLE after the weight jumps, until it has held for 3 seconds again", () => {
    hold(3000);
    pass(200);
    send(32_600);
    expect(reason()).toBe("NOT_STABLE");
    pass(200);
    hold(2600, 32_600);
    expect(reason()).toBe("NOT_STABLE");
    pass(200);
    hold(200, 32_600);
    expect(state.canCapture()).toMatchObject({ ok: true, kg: 32_600 });
  });

  it("starts again after going offline: old readings prove nothing", () => {
    hold(3000);
    state.disconnected("main");
    send();
    expect(reason()).toBe("NOT_STABLE");
  });

  it("keeps working over a long run, holding only the readings it needs", () => {
    for (let i = 0; i < 20; i++) {
      hold(3000);
      pass(200);
    }
    expect(state.canCapture().ok).toBe(true);
    // 3 s at 5 readings a second, plus the one from just before the window.
    expect(state.readingCount).toBeLessThanOrEqual(17);
  });

  it("works when readings do not land exactly on the window edge", () => {
    for (let i = 0; i < 20; i++) {
      send();
      pass(230);
    }
    send();
    expect(state.canCapture().ok).toBe(true);
  });

  it("rounds to whole kilograms", () => {
    hold(3000, 32_560.4);
    expect(state.canCapture()).toMatchObject({ kg: 32_560 });
    pass(200);
    send(-0.2);
    expect(Object.is(state.currentReading()!.kg, 0)).toBe(true);
  });
});

describe("online and offline", () => {
  const statuses = () => named("hw:status");

  it.each([
    ["main", 3000],
    ["front", 15_000],
    ["back", 15_000],
  ] as [DeviceId, number][])("marks %s offline after %i ms without a message", (device, limit) => {
    state.seen(device);
    pass(limit);
    state.checkTimeouts();
    expect(state.isOnline(device)).toBe(true);

    pass(1);
    state.checkTimeouts();
    expect(state.isOnline(device)).toBe(false);
    expect(statuses()).toEqual([
      { device, online: true },
      { device, online: false },
    ]);
  });

  it("reports each change once", () => {
    state.seen("front");
    state.seen("front");
    state.disconnected("front");
    state.disconnected("front");
    state.checkTimeouts();
    expect(statuses()).toEqual([
      { device: "front", online: true },
      { device: "front", online: false },
    ]);
  });

  it("reports offline then online when a message ends a silence no tick noticed", () => {
    state.seen("main");
    pass(5000);
    state.seen("main");
    expect(statuses()).toEqual([
      { device: "main", online: true },
      { device: "main", online: false },
      { device: "main", online: true },
    ]);
  });

  it("shows no weight while offline", () => {
    hold(3000);
    expect(state.snapshot().weight).toMatchObject({ kg: 32_560, positionOk: true, ageMs: 0 });
    pass(3001);
    const never = { online: false, lastSeenAt: null };
    expect(state.snapshot()).toEqual({
      weight: null,
      devices: { main: never, front: never, back: never },
      fault: null,
      canCapture: { ok: false, reason: "DEVICE_OFFLINE" },
    });
  });

  it("never puts the captured weight in the canCapture answer of the snapshot", () => {
    hold(3000);
    expect(state.snapshot().canCapture).toEqual({ ok: true, reason: null });
  });

  it("emits hw:weight for every reading", () => {
    hold(400, 100, false, false);
    expect(named("hw:weight")).toHaveLength(3);
    expect(named("hw:weight")[0]).toEqual({ kg: 100, stable: false, positionOk: false });
  });
});

describe("truck:arrived and truck:left", () => {
  const trucks = () => events.filter(([name]) => name.startsWith("truck:"));

  it("announces one arrival when the weight rises above the threshold", () => {
    for (const kg of [0, 300, 500, 501, 9000, 32_560]) send(kg);
    expect(trucks()).toEqual([["truck:arrived", { kg: 501 }]]);
  });

  it("waits for the position to be OK", () => {
    send(9000, false, false);
    expect(trucks()).toEqual([]);
    send(9100, false, true);
    expect(trucks()).toEqual([["truck:arrived", { kg: 9100 }]]);
  });

  it("announces nothing for a weight that never had a good position", () => {
    send(9000, false, false);
    send(0);
    expect(trucks()).toEqual([]);
  });

  it("does not leave just because the position stops being OK", () => {
    send(9000);
    send(9000, true, false);
    send(9000);
    expect(trucks()).toHaveLength(1);
  });

  it("announces leaving, and the next truck", () => {
    for (const kg of [32_560, 5000, 0, 0, 18_250]) send(kg);
    expect(trucks()).toEqual([
      ["truck:arrived", { kg: 32_560 }],
      ["truck:left", { kg: 0 }],
      ["truck:arrived", { kg: 18_250 }],
    ]);
  });

  it("ignores a wobble around the threshold", () => {
    for (const kg of [520, 480, 510, 400, 505, 400]) send(kg);
    expect(trucks()).toEqual([["truck:arrived", { kg: 520 }]]);
    send(399);
    expect(trucks().at(-1)).toEqual(["truck:left", { kg: 399 }]);
  });

  it("remembers the truck through an outage", () => {
    send(9000);
    state.disconnected("main");
    send(9000);
    expect(trucks()).toHaveLength(1);

    state.disconnected("main");
    send(0);
    expect(trucks().at(-1)).toEqual(["truck:left", { kg: 0 }]);
  });

  it("announces nothing until the settings are known", () => {
    settings = undefined;
    send(9000);
    expect(trucks()).toEqual([]);
    settings = SETTINGS;
    send(9000);
    expect(trucks()).toHaveLength(1);
  });
});
