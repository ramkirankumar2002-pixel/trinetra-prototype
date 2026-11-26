// Live events from the backend to the browsers (build plan section 7). The backend and the
// website both use these names and types. Browsers only listen: they send nothing.
import type { ApprovalKind, ApprovalStatus, TicketStatus } from "./domain";
import type { CaptureBlockReason, DeviceId } from "./hardware";

export interface HardwareWeightEvent {
  kg: number;
  /** The ESP32's own stable flag. canCapture is the one that counts. */
  stable: boolean;
  positionOk: boolean;
  /** Only the backend captures a weight; this tells the kiosk whether it could now. */
  canCapture: boolean;
  /** Why not, when canCapture is false. */
  reason: CaptureBlockReason | null;
  /** When the backend sent this, ISO 8601 in UTC. */
  at: string;
}

/** Which boards are online. */
export type HardwareStatusEvent = Record<DeviceId, boolean>;

export interface TruckEvent {
  kg: number;
  at: string;
}

export interface TicketUpdatedEvent {
  ticketId: number;
  status: TicketStatus;
}

export interface ApprovalNewEvent {
  approvalId: number;
  /** Null only for driver help asked before a ticket exists. */
  ticketId: number | null;
  kind: ApprovalKind;
}

export interface ApprovalDecidedEvent extends ApprovalNewEvent {
  status: Exclude<ApprovalStatus, "PENDING">;
}

export interface KioskReadyEvent {
  ticketId: number;
  ticketNo: string;
  plate: string;
}

/** The reading of an uploaded invoice has ended. The values are loaded over REST. */
export interface InvoiceReadEvent {
  ticketId: number;
  ok: boolean;
  /** An error code, such as READER_BUSY, when ok is false. */
  error: string | null;
}

/** Every event and what it carries. Events only announce: pages load details over REST. */
export interface RealtimeEvents {
  "hw:weight": HardwareWeightEvent;
  "hw:status": HardwareStatusEvent;
  "truck:arrived": TruckEvent;
  "truck:left": TruckEvent;
  "ticket:updated": TicketUpdatedEvent;
  "approval:new": ApprovalNewEvent;
  "approval:decided": ApprovalDecidedEvent;
  "kiosk:ready": KioskReadyEvent;
  "invoice:read": InvoiceReadEvent;
}

export type RealtimeEventName = keyof RealtimeEvents;

export type RoomKind = "kiosk" | "supervisor" | "store" | "live";
export type Room = "kiosk" | "store" | "live" | `supervisor:${number}`;

export function supervisorRoom(userId: number): Room {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new RangeError(`Not a user id: ${userId}`);
  }
  return `supervisor:${userId}`;
}

export const roomKind = (room: Room): RoomKind =>
  room.startsWith("supervisor:") ? "supervisor" : (room as RoomKind);

/**
 * Which kinds of room each event may be sent to. "live" is open to anyone without a login,
 * so only events with nothing private in them list it.
 */
export const EVENT_AUDIENCE: Readonly<Record<RealtimeEventName, readonly RoomKind[]>> = {
  "hw:weight": ["kiosk"],
  "hw:status": ["kiosk", "live"],
  "truck:arrived": ["kiosk"],
  "truck:left": ["kiosk"],
  "ticket:updated": ["kiosk", "supervisor", "store", "live"],
  "approval:new": ["supervisor", "store"],
  "approval:decided": ["kiosk", "supervisor", "store"],
  "kiosk:ready": ["kiosk"],
  "invoice:read": ["kiosk"],
};

export const REALTIME_EVENT_NAMES = Object.keys(EVENT_AUDIENCE) as RealtimeEventName[];

/** The Socket.IO type of the events the browser receives. */
export type ServerToClientEvents = {
  [Name in RealtimeEventName]: (payload: RealtimeEvents[Name]) => void;
};
/** Browsers send no events: rooms are chosen by the backend alone. */
export type ClientToServerEvents = Record<string, never>;

/**
 * What the browser puts in the Socket.IO handshake: a socket token from
 * GET /api/auth/socket-token, or `live: true` for the read-only room without a login.
 */
export type SocketAuth = { token: string } | { live: true };

/** The reason in `connect_error.message` when the backend refuses a connection. */
export const SOCKET_ERRORS = {
  /** No token, and not asking for the live room. */
  required: "TOKEN_REQUIRED",
  /** Wrong or expired token, or not a socket token. */
  invalid: "INVALID_TOKEN",
} as const;
