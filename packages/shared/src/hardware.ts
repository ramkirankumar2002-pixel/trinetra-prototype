// The weighbridge hardware as the backend and website see it (build plan section 7).

export const CAMERA_IDS = ["front", "back"] as const;
export type CameraId = (typeof CAMERA_IDS)[number];

/** "main" is the ESP32 with the load cells, sensors, lights, buzzer and display. */
export const DEVICE_IDS = ["main", ...CAMERA_IDS] as const;
export type DeviceId = (typeof DEVICE_IDS)[number];

export const LIGHT_COLOURS = ["green", "red", "orange"] as const;
export type LightColour = (typeof LIGHT_COLOURS)[number];

/** Why a weight cannot be captured now, in the order the checks are made. */
export const CAPTURE_BLOCK_REASONS = [
  /** The backend has not read the weighbridge settings from the database yet. */
  "SETTINGS_NOT_LOADED",
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
  devices: Record<DeviceId, { online: boolean }>;
  canCapture: CaptureCheck;
}
