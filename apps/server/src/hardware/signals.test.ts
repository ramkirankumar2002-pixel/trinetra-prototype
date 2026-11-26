import { beforeEach, describe, expect, it } from "vitest";
import { HardwareCommands } from "./commands";
import { createHardwareBus } from "./events";
import { goTo, SIGNALS, WeighbridgeSignals } from "./signals";
import type { DeviceHub } from "./hub";
import type { MainCommand } from "./messages";
import { HardwareState } from "./state";

const SETTINGS = { wakeThresholdKg: 500, stableWindowMs: 3000, stableSpreadKg: 10 };

describe("weighbridge signals", () => {
  let clock: number;
  let sent: string[];
  let state: HardwareState;
  let signals: WeighbridgeSignals;
  let bus: ReturnType<typeof createHardwareBus>;
  let connection: object;

  beforeEach(() => {
    clock = 0;
    sent = [];
    bus = createHardwareBus();
    state = new HardwareState(
      bus,
      () => SETTINGS,
      () => clock,
    );
    connection = {};
    const hub = {
      connectionOf: () => connection,
      send: (_device: string, command: MainCommand) => {
        if (command.t === "light") sent.push(`light ${command.c}`);
        else if (command.t === "display") sent.push(command.text);
        else if (command.t === "buzz") sent.push(`buzz ${command.ms}`);
        return true;
      },
    } as unknown as DeviceHub;
    const commands = new HardwareCommands(hub, state, () => SETTINGS);
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
    // The display already says "Please wait", so only the light changes.
    expect(take()).toEqual(["light orange", "Please wait", "light red"]);
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

  it("sends nothing when told to show what is already shown", () => {
    weigh(32_560);
    take();
    // As when a ticket starts just after the truck has arrived.
    signals.show(SIGNALS.processing);
    bus.emit("truck:arrived", { kg: 32_560 });
    expect(take()).toEqual([]);
  });

  it("sends only the part that changes", () => {
    weigh(32_560);
    signals.show(SIGNALS.wait);
    take();
    signals.show(SIGNALS.store);
    expect(take()).toEqual(["Go to store office"]);
  });

  it("sends everything again on a new connection", () => {
    weigh(32_560);
    take();
    connection = {};
    signals.show(SIGNALS.processing);
    expect(take()).toEqual(["light red", "Please wait"]);
  });
});
