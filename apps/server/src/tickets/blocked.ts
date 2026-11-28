// Why the weighbridge cannot be used right now, in words the kiosk can show.
import type { CaptureBlockReason } from "@trinetra/shared";
import { AppError } from "../errors/app-error";

const MESSAGES: Record<CaptureBlockReason, string> = {
  SETTINGS_NOT_LOADED: "The weighbridge is still starting. Try again in a moment.",
  WEIGHBRIDGE_FAULT: "Weighbridge fault. Please wait.",
  DEVICE_OFFLINE: "The weighbridge is offline.",
  STALE_READING: "No new weight has arrived from the weighbridge.",
  NO_TRUCK: "There is no truck on the bridge.",
  POSITION_NOT_OK: "Move fully onto the bridge.",
  NOT_STABLE: "The weight is still moving. Please stay still.",
};

/** The error code is the reason itself, such as NOT_STABLE. */
export const bridgeNotReady = (reason: CaptureBlockReason) =>
  new AppError(409, reason, MESSAGES[reason]);
