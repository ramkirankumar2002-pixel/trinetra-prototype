// Commands to the main ESP32.
import type { LightColour } from "@trinetra/shared";
import type { DeviceHub } from "./hub";
import { buzzMsSchema, displayTextSchema, lightColourSchema, type MainCommand } from "./messages";
import { MAX_CAPTURE_AGE_MS, type HardwareSettings, type HardwareState } from "./state";

export type CommandRefusal =
  | "DEVICE_OFFLINE"
  | "SETTINGS_NOT_LOADED"
  /** Tare only: no weight in the last second, so the bridge may not be empty. */
  | "STALE_READING"
  /** Tare only: there is something on the bridge. */
  | "BRIDGE_NOT_EMPTY";

export type CommandResult = { sent: true } | { sent: false; reason: CommandRefusal };

/** The helpers throw a ZodError for a wrong value, such as an empty display text. */
export class HardwareCommands {
  constructor(
    private readonly hub: DeviceHub,
    private readonly state: HardwareState,
    private readonly settings: () => HardwareSettings | undefined,
  ) {}

  setLight(colour: LightColour): CommandResult {
    return this.send({ t: "light", c: lightColourSchema.parse(colour) });
  }

  buzz(ms: number): CommandResult {
    return this.send({ t: "buzz", ms: buzzMsSchema.parse(ms) });
  }

  showText(text: string): CommandResult {
    return this.send({ t: "display", text: displayTextSchema.parse(text) });
  }

  /** Zeroes the scale. Refused unless the bridge is known to be empty. */
  tare(): CommandResult {
    const settings = this.settings();
    if (!settings) return { sent: false, reason: "SETTINGS_NOT_LOADED" };
    if (!this.state.isOnline("main")) return { sent: false, reason: "DEVICE_OFFLINE" };
    const reading = this.state.currentReading();
    if (!reading || reading.ageMs >= MAX_CAPTURE_AGE_MS) {
      // Zeroing with a truck on the bridge would make every later weight wrong.
      return { sent: false, reason: "STALE_READING" };
    }
    if (reading.kg >= settings.wakeThresholdKg) return { sent: false, reason: "BRIDGE_NOT_EMPTY" };
    return this.send({ t: "tare" });
  }

  private send(command: MainCommand): CommandResult {
    return this.state.isOnline("main") && this.hub.send("main", command)
      ? { sent: true }
      : { sent: false, reason: "DEVICE_OFFLINE" };
  }
}
