// What the kiosk knows about the weighbridge, from the live events. It is only shown:
// nothing here is ever sent back to the backend.
import type {
  CaptureBlockReason,
  HardwareStatusEvent,
  HardwareWeightEvent,
  KioskStateResponse,
} from "@trinetra/shared";
import { create } from "zustand";

/** With these answers the weight is above the wake threshold: a truck is on the bridge. */
const TRUCK_REASONS: ReadonlySet<CaptureBlockReason | null> = new Set([
  null,
  "NOT_STABLE",
  "POSITION_NOT_OK",
]);

/** An empty bridge for this long means the truck left, even if "truck:left" was missed. */
export const EMPTY_MEANS_GONE_MS = 3000;

export interface BridgeReading {
  kg: number;
  canCapture: boolean;
  /** Why a weight cannot be taken now; null when it can. */
  reason: CaptureBlockReason | null;
}

export interface BridgeState {
  /** Null until the backend has said. */
  devices: HardwareStatusEvent | null;
  /** Null while the weighbridge is offline or has sent nothing. */
  reading: BridgeReading | null;
  truckPresent: boolean;
  /** Goes up by one each time a truck leaves. */
  departures: number;
  emptySince: number | null;
}

export const EMPTY_BRIDGE: BridgeState = {
  devices: null,
  reading: null,
  truckPresent: false,
  departures: 0,
  emptySince: null,
};

const gone = (state: BridgeState): Partial<BridgeState> =>
  state.truckPresent
    ? { truckPresent: false, departures: state.departures + 1, emptySince: null }
    : { emptySince: null };

export function afterWeight(
  state: BridgeState,
  reading: BridgeReading,
  now: number,
): Partial<BridgeState> {
  if (TRUCK_REASONS.has(reading.reason)) {
    return { reading, truckPresent: true, emptySince: null };
  }
  if (reading.reason !== "NO_TRUCK" || !state.truckPresent) return { reading, emptySince: null };
  const since = state.emptySince ?? now;
  return now - since >= EMPTY_MEANS_GONE_MS
    ? { reading, ...gone(state) }
    : { reading, emptySince: since };
}

export function afterStatus(
  state: BridgeState,
  devices: HardwareStatusEvent,
): Partial<BridgeState> {
  return { devices, reading: devices.main ? state.reading : null };
}

/** From GET /api/kiosk/state: when the page loads, and after a lost connection. */
export function afterSnapshot(
  state: BridgeState,
  snapshot: KioskStateResponse,
): Partial<BridgeState> {
  const devices = {
    main: snapshot.devices.main.online,
    front: snapshot.devices.front.online,
    back: snapshot.devices.back.online,
  };
  const reason = snapshot.canCapture.reason;
  const reading = snapshot.weight
    ? { kg: snapshot.weight.kg, canCapture: snapshot.canCapture.ok, reason }
    : null;
  if (!reading) return { devices, reading };
  if (TRUCK_REASONS.has(reason)) {
    return { devices, reading, truckPresent: true, emptySince: null };
  }
  return { devices, reading, ...(reason === "NO_TRUCK" ? gone(state) : {}) };
}

interface BridgeStore extends BridgeState {
  weight: (event: HardwareWeightEvent) => void;
  status: (event: HardwareStatusEvent) => void;
  arrived: () => void;
  left: () => void;
  snapshot: (snapshot: KioskStateResponse) => void;
  clear: () => void;
}

export const useBridge = create<BridgeStore>()((set) => ({
  ...EMPTY_BRIDGE,
  weight: ({ kg, canCapture, reason }) =>
    set((state) => afterWeight(state, { kg, canCapture, reason }, Date.now())),
  status: (event) => set((state) => afterStatus(state, event)),
  arrived: () => set({ truckPresent: true, emptySince: null }),
  left: () => set((state) => gone(state)),
  snapshot: (snapshot) => set((state) => afterSnapshot(state, snapshot)),
  clear: () => set(EMPTY_BRIDGE),
}));
