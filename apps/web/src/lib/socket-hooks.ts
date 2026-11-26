"use client";

import type { RealtimeEventName, RealtimeEvents } from "@trinetra/shared";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { socketClient, type ConnectionStatus } from "./socket";

/** Keeps the newest function, so listeners are not removed and added on every render. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Runs `handler` for each event of this name. The payload is typed by the name. */
export function useSocketEvent<Name extends RealtimeEventName>(
  eventName: Name,
  handler: (payload: RealtimeEvents[Name]) => void,
): void {
  const latest = useLatest(handler);
  useEffect(() => {
    const { socket } = socketClient();
    const listener = (payload: RealtimeEvents[Name]) => latest.current(payload);
    // socket.io's types cannot follow a generic event name.
    socket.on<RealtimeEventName>(eventName, listener as never);
    return () => void socket.off<RealtimeEventName>(eventName, listener as never);
  }, [eventName, latest]);
}

/** Runs `callback` when a lost connection comes back: reload the page's data there. */
export function useOnReconnect(callback: () => void): void {
  const latest = useLatest(callback);
  useEffect(() => socketClient().onReconnect(() => latest.current()), [latest]);
}

export function useSocketStatus(): ConnectionStatus {
  return useSyncExternalStore(
    (listener) => socketClient().subscribeStatus(listener),
    () => socketClient().getStatus(),
    () => "idle",
  );
}
