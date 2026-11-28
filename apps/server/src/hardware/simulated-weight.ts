// Demo mode "weight": made-up readings take the place of the ESP32's. They go through the
// same HardwareState, so stability and canCapture work exactly as with real readings.
// Kept in memory only: after a restart the weight is real again, so demo mode never
// comes back by itself.
import type { HardwareState, WeightMessage } from "./state";

export const SIMULATED_EVERY_MS = 200;

export class SimulatedWeight {
  private value: WeightMessage | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly state: HardwareState,
    private readonly everyMs = SIMULATED_EVERY_MS,
  ) {}

  /** The simulated reading, or undefined while the ESP32's readings count. */
  current(): WeightMessage | undefined {
    return this.value;
  }

  set(value: WeightMessage): void {
    // Switching from the real weight: its readings must not help the new one look stable.
    if (!this.value) {
      this.state.disconnected("main");
      // The simulated weight stands in for a weighbridge that cannot be used, so a fault
      // reported by the real one is set aside. The ESP32 repeats it afterwards.
      this.state.setFault(null);
    }
    this.value = { ...value };
    this.state.addWeight(this.value);
    this.timer ??= setInterval(() => {
      if (this.value) this.state.addWeight(this.value);
    }, this.everyMs).unref();
  }

  /** Back to the real weighbridge, which must send fresh readings of its own. */
  stop(): void {
    if (!this.value) return;
    this.stopTimer();
    this.value = undefined;
    this.state.disconnected("main");
  }

  stopTimer(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
