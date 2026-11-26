// What the lights, buzzer and display on the weighbridge show (build plan step 73):
// green when ready, red while a truck is being processed, orange when it is done, and the
// buzzer when a truck is not fully on the bridge.
//
// The wanted light and text are remembered, so they can be sent again after the ESP32
// reconnects: commands are not queued while it is away. HardwareCommands sends a light or
// a text only when it changes.
import type { LightColour } from "@trinetra/shared";
import type { HardwareCommands } from "./commands";
import type { HardwareBus } from "./events";
import type { HardwareState } from "./state";

export interface Signal {
  light: LightColour;
  text: string;
}

export const SIGNALS = {
  ready: { light: "green", text: "Drive on" },
  processing: { light: "red", text: "Please wait" },
  wait: { light: "orange", text: "Please wait" },
  store: { light: "orange", text: "Go to store office" },
  thankYou: { light: "orange", text: "Thank you" },
  badPosition: { light: "red", text: "Move fully onto the bridge" },
} satisfies Record<string, Signal>;

export const goTo = (place: string): Signal => ({ light: "orange", text: `Go to ${place}` });

export const BUZZ_MS = 1000;
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
    // only set a light and a text, and nothing is created.
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
    if (!this.alarm) this.send(signal);
  }

  private watchPosition(): void {
    const bad = this.state.truckCheck().reason === "POSITION_NOT_OK";
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

  private send({ light, text }: Signal): void {
    // Refused while the ESP32 is away; it is sent again when it comes back.
    this.commands.setLight(light);
    this.commands.showText(text);
  }
}
