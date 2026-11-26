// The backend's internal hardware news. Phase 6 forwards it to the browsers.
import { EventEmitter } from "node:events";
import type { CameraId, DeviceId } from "@trinetra/shared";

export interface HardwareEvents {
  /** Every reading from the main ESP32, about 5 times a second. */
  "hw:weight": [{ kg: number; stable: boolean; positionOk: boolean }];
  /** A device went online or offline. */
  "hw:status": [{ device: DeviceId; online: boolean }];
  /** The weight rose above the wake threshold with the position OK. */
  "truck:arrived": [{ kg: number }];
  /** The truck that arrived has left the bridge. */
  "truck:left": [{ kg: number }];
  /** A camera's photo has been saved. */
  "camera:photo": [{ camera: CameraId; storagePath: string }];
}

export type HardwareBus = EventEmitter<HardwareEvents>;

export const createHardwareBus = (): HardwareBus => new EventEmitter<HardwareEvents>();
