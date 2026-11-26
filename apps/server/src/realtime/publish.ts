import { EVENT_AUDIENCE, roomKind, type Room } from "@trinetra/shared";
import type { RealtimeEventName, RealtimeEvents } from "@trinetra/shared";

export interface OutgoingEvent<Name extends RealtimeEventName = RealtimeEventName> {
  event: Name;
  rooms: readonly Room[];
  payload: RealtimeEvents[Name];
}

export type Publish = <Name extends RealtimeEventName>(
  event: Name,
  rooms: readonly Room[],
  payload: RealtimeEvents[Name],
) => void;

/** Throws on a mistake that would send an event to the wrong people. */
export function assertAudience(event: RealtimeEventName, rooms: readonly Room[]): void {
  // Socket.IO treats an empty list of rooms as "everyone".
  if (rooms.length === 0) throw new Error(`"${event}" has no room to go to.`);
  const allowed = EVENT_AUDIENCE[event];
  const wrong = rooms.filter((room) => !allowed.includes(roomKind(room)));
  if (wrong.length > 0) throw new Error(`"${event}" must not be sent to: ${wrong.join(", ")}`);
}
