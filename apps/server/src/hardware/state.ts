// What the backend knows about the weighbridge right now. THE BACKEND OWNS THE WEIGHT:
// a weight gets in here only as a checked message from the main ESP32, or from demo mode
// (simulated-weight.ts: kiosk login plus the admin PIN, and its tickets are tagged demo).
import {
  DEVICE_IDS,
  isStable,
  type CaptureCheck,
  type CaptureBlockReason,
  type DeviceId,
  type KioskStateResponse,
  type WeightReading,
} from "@trinetra/shared";
import type { HardwareBus } from "./events";

/** The ESP32 sends about 5 messages a second; each camera sends a heartbeat every 5 s. */
export const OFFLINE_AFTER_MS: Record<DeviceId, number> = {
  main: 3000,
  front: 15_000,
  back: 15_000,
};

/** A weight may be captured only if the newest reading is younger than this. */
export const MAX_CAPTURE_AGE_MS = 1000;

/**
 * "Truck left" needs the weight to fall this far below the wake threshold, so a weight
 * wobbling around the threshold does not announce a new truck over and over.
 */
export const LEFT_BELOW_FRACTION = 0.8;

export interface HardwareSettings {
  wakeThresholdKg: number;
  stableWindowMs: number;
  stableSpreadKg: number;
}

export interface WeightMessage {
  kg: number;
  stable: boolean;
  pos: boolean;
}

interface LatestReading extends WeightReading {
  positionOk: boolean;
}

export type CaptureDecision =
  { ok: true; reason: null; kg: number } | { ok: false; reason: CaptureBlockReason };

export class HardwareState {
  private readonly lastSeen = new Map<DeviceId, number>();
  /** The readings that cover the stability window, oldest first. */
  private readings: WeightReading[] = [];
  private latest: LatestReading | undefined;
  private truckOnBridge = false;

  constructor(
    private readonly bus: HardwareBus,
    /** Undefined until they have been read from the database. */
    private readonly settings: () => HardwareSettings | undefined,
    /** A clock that never jumps, unlike the time of day. */
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Any valid message from a device shows that it is alive. */
  seen(device: DeviceId): void {
    const wasOnline = this.lastSeen.has(device);
    // Notices a silence that no timer tick has caught yet, so the news stays in order.
    if (wasOnline && !this.isOnline(device)) this.goOffline(device);
    const cameOnline = !this.lastSeen.has(device);
    this.lastSeen.set(device, this.now());
    if (cameOnline) this.bus.emit("hw:status", { device, online: true });
  }

  addWeight(message: WeightMessage): void {
    this.seen("main");
    // Weights are whole kilograms everywhere.
    const kg = Math.round(message.kg) || 0;
    const reading = { kg, stable: message.stable, at: this.now(), positionOk: message.pos };
    this.latest = reading;
    this.readings.push(reading);
    this.forgetOldReadings(reading.at);
    this.bus.emit("hw:weight", { kg, stable: message.stable, positionOk: message.pos });
    this.watchForTrucks(kg, message.pos);
  }

  /** The connection closed or is being replaced. */
  disconnected(device: DeviceId): void {
    if (this.lastSeen.has(device)) this.goOffline(device);
  }

  /** Called on a timer: reports devices that have been silent for too long. */
  checkTimeouts(): void {
    for (const device of DEVICE_IDS) {
      if (this.lastSeen.has(device) && !this.isOnline(device)) this.goOffline(device);
    }
  }

  /** True while the device has sent something recently. Exact even between timer ticks. */
  isOnline(device: DeviceId): boolean {
    const seenAt = this.lastSeen.get(device);
    return seenAt !== undefined && this.now() - seenAt <= OFFLINE_AFTER_MS[device];
  }

  /** The newest reading and its age, or undefined if there is none or the ESP32 is offline. */
  currentReading(): (LatestReading & { ageMs: number }) | undefined {
    if (!this.latest || !this.isOnline("main")) return undefined;
    return { ...this.latest, ageMs: this.now() - this.latest.at };
  }

  /**
   * Is a truck standing fully on the bridge now? It need not be still. This is the part
   * of canCapture() that reading the number plate also needs.
   */
  truckCheck(): CaptureDecision {
    const no = (reason: CaptureBlockReason) => ({ ok: false as const, reason });
    const settings = this.settings();
    if (!settings) return no("SETTINGS_NOT_LOADED");
    if (!this.isOnline("main")) return no("DEVICE_OFFLINE");

    const reading = this.currentReading();
    if (!reading || reading.ageMs >= MAX_CAPTURE_AGE_MS) return no("STALE_READING");
    if (reading.kg <= settings.wakeThresholdKg) return no("NO_TRUCK");
    if (!reading.positionOk) return no("POSITION_NOT_OK");
    return { ok: true, reason: null, kg: reading.kg };
  }

  /**
   * May a weight be captured now? If so, `kg` is the weight to save: whoever captures
   * must take it from this same answer.
   */
  canCapture(): CaptureDecision {
    const truck = this.truckCheck();
    if (!truck.ok) return truck;
    const settings = this.settings()!;
    if (!isStable(this.readings, settings.stableWindowMs, settings.stableSpreadKg)) {
      return { ok: false, reason: "NOT_STABLE" };
    }
    return truck;
  }

  snapshot(): KioskStateResponse {
    const reading = this.currentReading();
    const decision = this.canCapture();
    const canCapture: CaptureCheck = decision.ok
      ? { ok: true, reason: null }
      : { ok: false, reason: decision.reason };
    return {
      weight: reading
        ? {
            kg: reading.kg,
            stable: reading.stable,
            positionOk: reading.positionOk,
            ageMs: Math.round(reading.ageMs),
          }
        : null,
      devices: {
        main: { online: this.isOnline("main") },
        front: { online: this.isOnline("front") },
        back: { online: this.isOnline("back") },
      },
      canCapture,
    };
  }

  /** How many readings are held: only those that cover the window. */
  get readingCount(): number {
    return this.readings.length;
  }

  private goOffline(device: DeviceId): void {
    this.lastSeen.delete(device);
    if (device === "main") {
      // We no longer know what the weight did, so stability starts again from nothing.
      this.readings = [];
      this.latest = undefined;
    }
    this.bus.emit("hw:status", { device, online: false });
  }

  /**
   * Keeps the window plus the one reading from just before it: isStable() needs that one
   * to know the weight when the window began.
   */
  private forgetOldReadings(newest: number): void {
    const windowStart = newest - (this.settings()?.stableWindowMs ?? 3000);
    let drop = 0;
    while (drop + 1 < this.readings.length && this.readings[drop + 1]!.at <= windowStart) drop += 1;
    if (drop > 0) this.readings.splice(0, drop);
  }

  private watchForTrucks(kg: number, positionOk: boolean): void {
    const threshold = this.settings()?.wakeThresholdKg;
    if (threshold === undefined) return;

    if (!this.truckOnBridge && kg > threshold && positionOk) {
      this.truckOnBridge = true;
      this.bus.emit("truck:arrived", { kg });
    } else if (this.truckOnBridge && kg < threshold * LEFT_BELOW_FRACTION) {
      this.truckOnBridge = false;
      this.bus.emit("truck:left", { kg });
    }
  }
}
