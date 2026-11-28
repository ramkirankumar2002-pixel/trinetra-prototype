// Commands to the main ESP32.
import type { Lights } from "@trinetra/shared";
import type { DeviceHub } from "./hub";
import { buzzSchema, displayLinesSchema, lightsSchema, type MainCommand } from "./messages";
import { MAX_CAPTURE_AGE_MS, type HardwareSettings, type HardwareState } from "./state";

export type CommandRefusal =
  | "DEVICE_OFFLINE"
  | "SETTINGS_NOT_LOADED"
  /** Tare only: no weight in the last second, so the bridge may not be empty. */
  | "STALE_READING"
  /** Tare only: there is something on the bridge. */
  | "BRIDGE_NOT_EMPTY";

export type CommandResult = { sent: true } | { sent: false; reason: CommandRefusal };

/** What the ESP32 has been told, on one connection. */
interface Told {
  connection: object;
  /** The command as it was sent, to see whether a new one would change anything. */
  light?: string;
  text?: string;
}

/** The helpers throw a ZodError for a wrong value, such as a display line too long. */
export class HardwareCommands {
  private told: Told | undefined;

  constructor(
    private readonly hub: DeviceHub,
    private readonly state: HardwareState,
    private readonly settings: () => HardwareSettings | undefined,
  ) {}

  /** Both traffic lights. Not sent again if they already show this. */
  setLights(lights: Lights): CommandResult {
    return this.change("light", { t: "light", ...lightsSchema.parse(lights) });
  }

  /** `times` beeps of `ms` each, `gap` milliseconds apart. */
  buzz(ms: number, times = 1, gap = 120): CommandResult {
    return this.send({ t: "buzz", ...buzzSchema.parse({ ms, times, gap }) });
  }

  /** Not sent again if the display already shows these lines. */
  showLines(lines: string[]): CommandResult {
    return this.change("text", { t: "display", lines: displayLinesSchema.parse(lines) });
  }

  /**
   * Forgets what the light and display show, so the next command is sent whatever it is.
   * For after a silence: the ESP32 may have restarted.
   */
  forgetDeviceState(): void {
    this.told = undefined;
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

  private change(part: "light" | "text", command: MainCommand): CommandResult {
    const value = JSON.stringify(command);
    const connection = this.hub.connectionOf("main");
    if (this.told && this.told.connection !== connection) this.told = undefined;
    if (this.state.isOnline("main") && this.told?.[part] === value) return { sent: true };

    const result = this.send(command);
    if (result.sent && connection) this.told = { ...this.told, connection, [part]: value };
    return result;
  }

  private send(command: MainCommand): CommandResult {
    return this.state.isOnline("main") && this.hub.send("main", command)
      ? { sent: true }
      : { sent: false, reason: "DEVICE_OFFLINE" };
  }
}
