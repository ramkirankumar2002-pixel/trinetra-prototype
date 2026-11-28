// What the two traffic lights, buzzer and display on the weighbridge show (build plan step
// 73). THE SERVER DECIDES the lights: the entry end is green when a truck may drive on, both
// are red while it is weighed, and the exit end is green when it may drive off. The buzzer
// sounds when a truck is not fully on the bridge. The ESP32 itself adds only two things:
// yellow with "Move FORWARD/BACK" while a truck is being positioned, and its tamper alarm,
// which wins over everything.
//
// The wanted lights and text are remembered, so they can be sent again after the ESP32
// reconnects: commands are not queued while it is away. HardwareCommands sends lights or a
// text only when they change.
import { DISPLAY_LINE_CHARS, type Lights } from "@trinetra/shared";
import type { HardwareCommands } from "./commands";
import type { HardwareBus } from "./events";
import type { HardwareState } from "./state";

export interface Signal {
  lights: Lights;
  /** Top (small), middle (large), bottom (small). */
  lines: [string, string, string];
  /**
   * The truck may drive off: it crosses the exit sensor on its way, which is then not a
   * bad position.
   */
  leaving?: boolean;
}

const DRIVE_ON: Lights = { entry: "G", exit: "R" };
const STOP: Lights = { entry: "R", exit: "R" };
const DRIVE_OFF: Lights = { entry: "R", exit: "G" };

export const SIGNALS = {
  ready: { lights: DRIVE_ON, lines: ["TRINETRA READY", "DRIVE ON", "Entry is green"] },
  processing: { lights: STOP, lines: ["PLEASE", "WAIT", "Hold still"] },
  /** Type 2: the truck waits aside for the store officer. */
  wait: { lights: DRIVE_OFF, lines: ["Move aside and", "WAIT", "Drive off ->"], leaving: true },
  /** On hold after the second weight. */
  store: { lights: DRIVE_OFF, lines: ["Go to the store", "OFFICE", "Drive off ->"], leaving: true },
  /** Before the first weight: the driver goes to the office, the truck stays. */
  officeFirst: { lights: STOP, lines: ["Go to the store", "OFFICE", "Please wait"] },
  thankYou: {
    lights: DRIVE_OFF,
    lines: ["Weighing done", "THANK YOU", "Drive off ->"],
    leaving: true,
  },
  badPosition: { lights: STOP, lines: ["POSITION TRUCK", "MOVE", "Fully onto bridge"] },
} satisfies Record<string, Signal>;

export const goTo = (place: string): Signal => ({
  lights: DRIVE_OFF,
  lines: ["Unload at", place.slice(0, DISPLAY_LINE_CHARS), "Drive off ->"],
  leaving: true,
});

export const BUZZ_MS = 1000;
/** Two short beeps: a weight has been taken. */
export const CAPTURED_BEEP = { ms: 120, times: 2 };
/** A flickering position sensor must not make the buzzer sound without a pause. */
export const BUZZ_AGAIN_AFTER_MS = 3000;

export class WeighbridgeSignals {
  private wanted: Signal = SIGNALS.ready;
  private alarm = false;
  private buzzedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly commands: HardwareCommands,
    private readonly state: HardwareState,
    bus: HardwareBus,
    private readonly now: () => number = () => performance.now(),
  ) {
    // Safe to hear twice, as after a restart with a truck already on the bridge: these
    // only set lights and a text, and nothing is created.
    bus.on("truck:arrived", () => this.show(SIGNALS.processing));
    bus.on("truck:left", () => this.show(SIGNALS.ready));
    bus.on("hw:status", ({ device, online }) => {
      if (device !== "main" || !online) return;
      this.commands.forgetDeviceState();
      this.send(this.alarm ? SIGNALS.badPosition : this.wanted);
    });
    bus.on("hw:weight", () => this.watchPosition());
  }

  /** What to show now. During a position alarm it is shown once the alarm ends. */
  show(signal: Signal): void {
    this.wanted = signal;
    if (signal.leaving) this.alarm = false;
    if (!this.alarm) this.send(signal);
  }

  private watchPosition(): void {
    const bad = !this.wanted.leaving && this.state.truckCheck().reason === "POSITION_NOT_OK";
    if (bad === this.alarm) return;
    this.alarm = bad;
    if (!bad) {
      this.send(this.wanted);
      return;
    }
    this.send(SIGNALS.badPosition);
    if (this.now() - this.buzzedAt >= BUZZ_AGAIN_AFTER_MS) {
      this.buzzedAt = this.now();
      this.commands.buzz(BUZZ_MS);
    }
  }

  private send({ lights, lines }: Signal): void {
    // Refused while the ESP32 is away; it is sent again when it comes back.
    this.commands.setLights(lights);
    this.commands.showLines(lines);
  }
}
