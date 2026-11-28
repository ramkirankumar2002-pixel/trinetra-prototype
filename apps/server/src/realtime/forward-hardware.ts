// Sends the hardware news from the internal bus to the browsers that may see it.
import type { HardwareStatusEvent, HardwareWeightEvent } from "@trinetra/shared";
import type { Hardware } from "../hardware";
import type { SocketServer } from "./socket-server";
import { throttle } from "./throttle";

/** hw:weight goes out at most 5 times a second. */
export const WEIGHT_INTERVAL_MS = 200;

export function forwardHardware(
  hardware: Hardware,
  realtime: SocketServer,
  /** A short-lived link to a stored photo. */
  photoUrl: (storagePath: string) => Promise<string>,
  onError: (error: unknown) => void,
) {
  const { bus, state } = hardware;
  const timestamp = () => new Date().toISOString();

  const status = (): HardwareStatusEvent => ({
    main: state.isOnline("main"),
    front: state.isOnline("front"),
    back: state.isOnline("back"),
  });

  /** Built when it is sent, so canCapture is as fresh as possible. */
  const weightNow = (): HardwareWeightEvent | undefined => {
    const reading = state.currentReading();
    if (!reading) return undefined;
    const decision = state.canCapture();
    return {
      kg: reading.kg,
      stable: reading.stable,
      positionOk: reading.positionOk,
      canCapture: decision.ok,
      reason: decision.reason,
      at: timestamp(),
    };
  };

  const weight = throttle(() => {
    const payload = weightNow();
    if (payload) realtime.publish("hw:weight", ["kiosk"], payload);
  }, WEIGHT_INTERVAL_MS);

  bus.on("hw:weight", () => weight.request());
  bus.on("hw:status", ({ device, online }) => {
    // No weight may follow the news that the weighbridge is offline.
    if (device === "main" && !online) weight.cancel();
    realtime.publish("hw:status", ["kiosk", "live"], status());
  });
  bus.on("hw:fault", ({ fault }) => {
    if (fault) weight.cancel();
    realtime.publish("hw:fault", ["kiosk", "store"], { fault });
  });
  bus.on("truck:arrived", ({ kg }) =>
    realtime.publish("truck:arrived", ["kiosk"], { kg, at: timestamp() }),
  );
  bus.on("truck:left", ({ kg }) =>
    realtime.publish("truck:left", ["kiosk"], { kg, at: timestamp() }),
  );

  // So the kiosk can show each photo the moment it arrives, before the plates are read.
  bus.on("camera:photo", ({ camera, storagePath }) => {
    photoUrl(storagePath)
      .then((url) => realtime.publish("photo:arrived", ["kiosk"], { camera, url }))
      .catch(onError);
  });

  // A screen that has just connected learns which boards are online without waiting
  // for something to change.
  realtime.onJoin((room, emit) => {
    if (room === "kiosk" || room === "live") emit("hw:status", [room], status());
    // Also "no fault": a screen that was away must not keep showing an old one.
    if (room === "kiosk" || room === "store") emit("hw:fault", [room], { fault: state.fault });
  });

  return { stop: () => weight.cancel() };
}
