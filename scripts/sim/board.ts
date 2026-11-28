// Pretend boards that speak exactly what the firmware speaks (README "Device connection"):
// the main ESP32 over the /device WebSocket, in GRAMS on the model, and each ESP32-CAM by
// POSTing JPEG frames. The simulator, "pnpm journey" and the browser tests all use these.
//
// The tests think in truck kilograms, so the main board turns them into model grams with
// the model scale before sending; the backend turns them back, as with the real board.
import {
  DEFAULT_MODEL_SCALE,
  type CameraId,
  type TamperReason,
  type TruckPosition,
} from "@trinetra/shared";
import { SimDevice } from "./device";
import { WeightModel, type Reading } from "./weight-model";

/** As the firmware does. */
export const WEIGHT_EVERY_MS = 200;
export const TAMPER_EVERY_MS = 1000;
export const FRAME_EVERY_MS = 1500;

export type BadSide = Exclude<TruckPosition, "ok">;

/** The "w" message for a reading of so many truck kilograms. */
export function weightMessage(reading: Reading, kgPerGram: number, badSide: BadSide = "forward") {
  return {
    t: "w" as const,
    g: Math.round((reading.kg / kgPerGram) * 10_000) / 10_000,
    stable: reading.stable,
    pos: reading.pos ? ("ok" as const) : badSide,
  };
}

export interface SimMainOptions {
  /** The /device address, such as ws://localhost:4000/device. */
  url: string;
  token: string;
  /** The backend's model scale, so that "32,560 kg" arrives as 32,560 kg. */
  kgPerGram?: number;
  log?: (text: string) => void;
  onCommand?: (command: Record<string, unknown>) => void;
  /** Told of every weight sent. */
  onWeight?: (reading: Reading) => void;
}

export class SimMainBoard {
  readonly model = new WeightModel();
  /** Which IR sensor is blocked while the position is not OK. */
  badSide: BadSide = "forward";
  kgPerGram: number;
  private tamper: TamperReason | null = null;
  private tamperSentAt = 0;
  private readonly device: SimDevice;
  private sender: NodeJS.Timeout | undefined;

  constructor(private readonly options: SimMainOptions) {
    this.kgPerGram = options.kgPerGram ?? DEFAULT_MODEL_SCALE;
    this.device = new SimDevice({
      name: "main ESP32",
      url: options.url,
      token: options.token,
      log: options.log ?? (() => {}),
      // Like the firmware: after connecting it says whether the wiring is healthy.
      onOpen: () => this.sendWiringState(),
      onCommand: options.onCommand ?? (() => {}),
    });
  }

  start(): void {
    this.device.connect();
    this.sender = setInterval(() => this.tick(), WEIGHT_EVERY_MS);
  }

  stop(): void {
    clearInterval(this.sender);
    this.device.close();
  }

  goOffline(ms: number): void {
    this.device.goOffline(ms);
  }

  /** Tampering begins (a reason) or ends (null). */
  setTamper(reason: TamperReason | null): void {
    this.tamper = reason;
    this.sendWiringState();
  }

  private sendWiringState(): void {
    this.tamperSentAt = performance.now();
    this.device.send(this.tamper ? { t: "tamper", reason: this.tamper } : { t: "tamper_clear" });
  }

  private tick(): void {
    if (this.tamper) {
      // During an alarm the firmware weighs nothing, and repeats the alarm.
      if (performance.now() - this.tamperSentAt >= TAMPER_EVERY_MS) this.sendWiringState();
      return;
    }
    const reading = this.model.read(performance.now());
    this.device.send(weightMessage(reading, this.kgPerGram, this.badSide));
    this.options.onWeight?.(reading);
  }
}

export interface SimCameraOptions {
  /** The backend, such as http://localhost:4000. */
  httpBase: string;
  camera: CameraId;
  token: string;
  /** The JPEG this camera sees now. */
  picture: () => Promise<Uint8Array>;
  log?: (text: string) => void;
  everyMs?: number;
}

export class SimCamera {
  private timer: NodeJS.Timeout | undefined;
  private resume: NodeJS.Timeout | undefined;
  private sending = false;
  private lastNews = "";

  constructor(private readonly options: SimCameraOptions) {}

  start(): void {
    this.stop();
    void this.send();
    this.timer = setInterval(() => void this.send(), this.options.everyMs ?? FRAME_EVERY_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    clearTimeout(this.resume);
    this.timer = undefined;
  }

  goOffline(ms: number): void {
    this.stop();
    this.resume = setTimeout(() => this.start(), ms);
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** One frame. Answers the HTTP status, or 0 if the backend could not be reached. */
  async send(): Promise<number> {
    if (this.sending) return 0;
    this.sending = true;
    const { httpBase, camera, token, picture } = this.options;
    try {
      const response = await fetch(`${httpBase}/api/cam/${camera}`, {
        method: "POST",
        headers: { "content-type": "image/jpeg", "x-device-token": token },
        body: new Uint8Array(await picture()),
        signal: AbortSignal.timeout(5000),
      });
      this.news(
        response.ok ? "sending frames" : `refused: ${response.status} ${await response.text()}`,
      );
      return response.status;
    } catch (error) {
      this.news(`cannot send: ${(error as Error).message}`);
      return 0;
    } finally {
      this.sending = false;
    }
  }

  /** Only changes are logged: a frame goes every second or two. */
  private news(text: string): void {
    if (text === this.lastNews) return;
    this.lastNews = text;
    this.options.log?.(`${this.options.camera} camera: ${text}`);
  }
}
