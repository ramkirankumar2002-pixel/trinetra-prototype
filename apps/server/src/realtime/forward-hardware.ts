// Sends the hardware news from the internal bus to the browsers that may see it.
import type { HardwareStatusEvent, HardwareWeightEvent } from "@trinetra/shared";
import type { Hardware } from "../hardware";
import type { SocketServer } from "./socket-server";
import { throttle } from "./throttle";

/** hw:weight goes out at most 5 times a second. */
export const WEIGHT_INTERVAL_MS = 200;

export function forwardHardware(hardware: Hardware, realtime: SocketServer) {
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
  bus.on("truck:arrived", ({ kg }) =>
    realtime.publish("truck:arrived", ["kiosk"], { kg, at: timestamp() }),
  );
  bus.on("truck:left", ({ kg }) =>
    realtime.publish("truck:left", ["kiosk"], { kg, at: timestamp() }),
  );

  // A screen that has just connected learns which boards are online without waiting
  // for something to change.
  realtime.onJoin((room, emit) => {
    if (room === "kiosk" || room === "live") emit("hw:status", [room], status());
  });

  return { stop: () => weight.cancel() };
}
