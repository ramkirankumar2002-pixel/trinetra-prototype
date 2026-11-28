// The weighbridge hardware as the backend and website see it (build plan section 7).

export const CAMERA_IDS = ["front", "back"] as const;
export type CameraId = (typeof CAMERA_IDS)[number];

/** "main" is the ESP32 with the load cells, sensors, lights, buzzer and display. */
export const DEVICE_IDS = ["main", ...CAMERA_IDS] as const;
export type DeviceId = (typeof DEVICE_IDS)[number];

/** What one of the two traffic lights shows. */
export const LIGHT_STATES = ["R", "Y", "G", "off"] as const;
export type LightState = (typeof LIGHT_STATES)[number];

/** Both traffic lights, as one command: the entry end and the exit end of the bridge. */
export interface Lights {
  entry: LightState;
  exit: LightState;
  /** The lights that are not off flash. */
  blink?: boolean;
}

/** The OLED is 128 pixels wide: this many characters of the small font. */
export const DISPLAY_LINE_CHARS = 21;
/** Top line (small), middle line (large if it fits), bottom line (small). */
export const DISPLAY_MAX_LINES = 3;

/**
 * Where the IR sensors say the truck is. "forward": it still covers the entry end.
 * "back": it covers the exit end.
 */
export const TRUCK_POSITIONS = ["ok", "forward", "back"] as const;
export type TruckPosition = (typeof TRUCK_POSITIONS)[number];

/** Why the main ESP32 thinks the load cell wiring was tampered with (its own words). */
export const TAMPER_REASONS = [
  "HX711 NO DATA",
  "CELL WIRE OPEN",
  "HX711 STUCK",
  "CELL WIRE FAULT",
] as const;
export type TamperReason = (typeof TAMPER_REASONS)[number];

/** A weighbridge fault that is happening now. Nothing can be weighed until it is over. */
export interface WeighbridgeFault {
  reason: TamperReason;
  /** When the backend first heard of it, ISO 8601 in UTC. */
  since: string;
}

/**
 * The model weighbridge: 1 gram on the model stands for this many kilograms of a truck.
 * Only the backend converts. The value is a setting on /settings.
 */
export const DEFAULT_MODEL_SCALE = 100;
export const MAX_MODEL_SCALE = 1000;
/** The stable band, in grams on the model (± this). */
export const MAX_STABLE_BAND_G = 100;

/** Model grams to truck kilograms. Weights are whole kilograms everywhere. */
export const gramsToKg = (grams: number, kgPerGram: number): number =>
  Math.round(grams * kgPerGram) || 0;

/** A camera frame older than this is not used as a photo of the truck. */
export const MAX_FRAME_AGE_MS = 3000;

/** Why a weight cannot be captured now, in the order the checks are made. */
export const CAPTURE_BLOCK_REASONS = [
  /** The backend has not read the weighbridge settings from the database yet. */
  "SETTINGS_NOT_LOADED",
  /** The main ESP32 reports that the load cell wiring was tampered with. */
  "WEIGHBRIDGE_FAULT",
  "DEVICE_OFFLINE",
  /** No weight in the last second. */
  "STALE_READING",
  /** The weight is not above the wake threshold. */
  "NO_TRUCK",
  "POSITION_NOT_OK",
  "NOT_STABLE",
] as const;
export type CaptureBlockReason = (typeof CAPTURE_BLOCK_REASONS)[number];

export type CaptureCheck = { ok: true; reason: null } | { ok: false; reason: CaptureBlockReason };

/** Returned by GET /api/kiosk/state. The kiosk only shows it; it never sends a weight back. */
export interface KioskStateResponse {
  /** The newest reading, or null while the weighbridge is offline or has sent nothing. */
  weight: {
    kg: number;
    /** The ESP32's own stable flag. canCapture is the one that counts. */
    stable: boolean;
    positionOk: boolean;
    ageMs: number;
  } | null;
  /** lastSeenAt: when the real board was last heard. Null: not since the server started. */
  devices: Record<DeviceId, { online: boolean; lastSeenAt: string | null }>;
  /** The weighbridge fault happening now, or null. */
  fault: WeighbridgeFault | null;
  canCapture: CaptureCheck;
}
