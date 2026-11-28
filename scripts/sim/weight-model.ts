// What the simulated load cells and sensors report, as a function of time. No I/O.

/** The simulator's trucks. They differ by 20,000 kg, which is what the demo bills say. */
export const LOADED_KG = 32_500;
export const EMPTY_KG = 12_500;

const DRIVE_ON_MS = 3000;
const SETTLE_WOBBLE_MS = 2000;
const DRIVE_OFF_MS = 2000;
/** Like the real ESP32, the stable flag comes on a moment after the weight stops moving. */
const STABLE_FLAG_DELAY_MS = 1000;
const SETTLE_WOBBLE_KG = 150;
const UNSTABLE_WOBBLE_KG = 120;

export interface Reading {
  kg: number;
  stable: boolean;
  pos: boolean;
}

export class WeightModel {
  private from = 0;
  private target = 0;
  private startedAt = Number.NEGATIVE_INFINITY;
  private wobbleEndedAt = Number.NEGATIVE_INFINITY;
  unstable = false;
  positionOk = true;

  /** A truck drives onto the bridge: the weight climbs, wobbles, then settles. */
  arrive(targetKg: number, now: number): void {
    this.drive(targetKg, now);
  }

  leave(now: number): void {
    this.drive(0, now);
  }

  togglePosition(): boolean {
    return (this.positionOk = !this.positionOk);
  }

  toggleUnstable(now: number): boolean {
    this.unstable = !this.unstable;
    if (!this.unstable) this.wobbleEndedAt = now;
    return this.unstable;
  }

  read(now: number): Reading {
    const elapsed = now - this.startedAt;
    const rampMs = this.target === 0 ? DRIVE_OFF_MS : DRIVE_ON_MS;
    const wobbleMs = this.target === 0 ? 0 : SETTLE_WOBBLE_MS;
    let kg = this.target;

    if (elapsed < rampMs) {
      const part = Math.max(0, elapsed) / rampMs;
      // Slow at both ends, like a truck rolling on.
      kg = this.from + (this.target - this.from) * part * part * (3 - 2 * part);
    } else if (elapsed < rampMs + wobbleMs) {
      const fading = 1 - (elapsed - rampMs) / wobbleMs;
      kg += Math.sin((elapsed - rampMs) / 90) * SETTLE_WOBBLE_KG * fading;
    }
    if (this.unstable) kg += Math.sin(now / 110) * UNSTABLE_WOBBLE_KG;

    const stillSince = Math.max(this.startedAt + rampMs + wobbleMs, this.wobbleEndedAt);
    return {
      kg: Math.round(kg) || 0,
      stable: !this.unstable && now - stillSince >= STABLE_FLAG_DELAY_MS,
      pos: this.positionOk,
    };
  }

  private drive(targetKg: number, now: number): void {
    this.from = this.read(now).kg;
    this.target = targetKg;
    this.startedAt = now;
  }
}
