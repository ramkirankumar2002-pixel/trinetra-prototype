import { beforeEach, describe, expect, it } from "vitest";
import type { HardwareCommands } from "./commands";
import { createHardwareBus } from "./events";
import { goTo, SIGNALS, WeighbridgeSignals } from "./signals";
import { HardwareState } from "./state";

const SETTINGS = { wakeThresholdKg: 500, stableWindowMs: 3000, stableSpreadKg: 10 };

describe("weighbridge signals", () => {
  let clock: number;
  let sent: string[];
  let state: HardwareState;
  let signals: WeighbridgeSignals;
  let bus: ReturnType<typeof createHardwareBus>;

  beforeEach(() => {
    clock = 0;
    sent = [];
    bus = createHardwareBus();
    state = new HardwareState(
      bus,
      () => SETTINGS,
      () => clock,
    );
    const ok = { sent: true as const };
    const commands = {
      setLight: (c: string) => (sent.push(`light ${c}`), ok),
      showText: (text: string) => (sent.push(text), ok),
      buzz: (ms: number) => (sent.push(`buzz ${ms}`), ok),
    } as unknown as HardwareCommands;
    signals = new WeighbridgeSignals(commands, state, bus, () => clock);
  });

  const weigh = (kg: number, pos = true) => {
    clock += 200;
    state.addWeight({ kg, stable: false, pos });
  };
  const take = () => sent.splice(0);

  it("says it is ready when the weighbridge comes online", () => {
    weigh(0);
    expect(take()).toEqual(["light green", "Drive on"]);
  });

  it("is red while a truck is processed and green once it has left", () => {
    weigh(0);
    take();
    weigh(32_560);
    expect(take()).toEqual(["light red", "Please wait"]);
    signals.show(goTo("CH-005+250"));
    expect(take()).toEqual(["light orange", "Go to CH-005+250"]);
    weigh(0);
    expect(take()).toEqual(["light green", "Drive on"]);
  });

  it("buzzes once for a bad position, then shows what was there before", () => {
    weigh(0);
    take();
    weigh(32_560, false);
    expect(take()).toEqual(["light red", "Move fully onto the bridge", "buzz 1000"]);
    weigh(32_560, false);
    // Nothing is shown over the alarm.
    signals.show(SIGNALS.wait);
    expect(take()).toEqual([]);
    weigh(32_560);
    // The truck is now fully on: it has arrived, and is being processed.
    expect(take().at(-1)).toBe("Please wait");
  });

  it("does not sound again at once when the sensor flickers", () => {
    weigh(32_560);
    weigh(32_560, false);
    weigh(32_560);
    take();
    weigh(32_560, false);
    expect(take()).not.toContain("buzz 1000");
    weigh(32_560);
    clock += 3000;
    weigh(32_560, false);
    expect(take()).toContain("buzz 1000");
  });

  it("sends the same signal again after the ESP32 reconnects", () => {
    weigh(32_560);
    signals.show(SIGNALS.thankYou);
    state.disconnected("main");
    take();
    weigh(32_560);
    expect(take()).toEqual(["light orange", "Thank you"]);
  });

  it("can hear truck:arrived twice", () => {
    bus.emit("truck:arrived", { kg: 32_560 });
    bus.emit("truck:arrived", { kg: 32_560 });
    expect(sent).toEqual(["light red", "Please wait", "light red", "Please wait"]);
  });
});
