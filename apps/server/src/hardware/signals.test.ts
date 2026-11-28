import { beforeEach, describe, expect, it } from "vitest";
import { HardwareCommands } from "./commands";
import { createHardwareBus } from "./events";
import { goTo, SIGNALS, WeighbridgeSignals } from "./signals";
import type { DeviceHub } from "./hub";
import type { MainCommand } from "./messages";
import { HardwareState } from "./state";

const SETTINGS = {
  wakeThresholdKg: 500,
  stableWindowMs: 3000,
  stableSpreadKg: 10,
  modelScaleKgPerG: 100,
};

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
        if (command.t === "light") sent.push(`light ${command.entry}${command.exit}`);
        else if (command.t === "display") sent.push(command.lines[1]!);
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

  // The lights are written as entry then exit: "GR" is entry green, exit red.

  it("lets a truck drive on when the weighbridge comes online", () => {
    weigh(0);
    expect(take()).toEqual(["light GR", "DRIVE ON"]);
  });

  it("is red at both ends while a truck is processed, then lets it off and the next on", () => {
    weigh(0);
    take();
    weigh(32_560);
    expect(take()).toEqual(["light RR", "WAIT"]);
    signals.show(goTo("CH-005+250"));
    expect(take()).toEqual(["light RG", "CH-005+250"]);
    weigh(0);
    expect(take()).toEqual(["light GR", "DRIVE ON"]);
  });

  it("buzzes once for a bad position, then shows what was there before", () => {
    weigh(0);
    take();
    weigh(32_560, false);
    expect(take()).toEqual(["light RR", "MOVE", "buzz 1000"]);
    weigh(32_560, false);
    // Nothing is shown over the alarm.
    signals.show(SIGNALS.officeFirst);
    expect(take()).toEqual([]);
    weigh(32_560);
    // The truck is now fully on: what was wanted comes back, then it has arrived.
    expect(take()).toEqual(["OFFICE", "WAIT"]);
  });

  it("does not call a truck driving off badly placed", () => {
    weigh(32_560);
    signals.show(goTo("CH-005+250"));
    take();
    // It crosses the exit sensor on its way off.
    weigh(30_000, false);
    weigh(12_000, false);
    expect(take()).toEqual([]);
    weigh(0);
    expect(take()).toEqual(["light GR", "DRIVE ON"]);
  });

  it("ends a position alarm when the truck is told to drive off", () => {
    weigh(32_560);
    weigh(32_560, false);
    take();
    signals.show(SIGNALS.thankYou);
    expect(take()).toEqual(["light RG", "THANK YOU"]);
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
    expect(take()).toEqual(["light RG", "THANK YOU"]);
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
    expect(take()).toEqual(["OFFICE"]);
  });

  it("sends everything again on a new connection", () => {
    weigh(32_560);
    take();
    connection = {};
    signals.show(SIGNALS.processing);
    expect(take()).toEqual(["light RR", "WAIT"]);
  });
});
