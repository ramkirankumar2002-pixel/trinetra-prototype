// The ticket lifecycle (build plan section 6). Only the backend changes a status, and it
// does so through transition(). The website may use canTransition() to enable buttons.
import {
  CLOSED_TICKET_STATUSES,
  type ApprovalKind,
  type ApprovalStatus,
  type PlateWarningReason,
  type TicketStatus,
  type TicketType,
} from "../domain";

export const TICKET_EVENTS = [
  /** 5th time the driver's material did not match the invoice. */
  "MISMATCH_LIMIT_REACHED",
  "MISMATCH_RESOLVED",
  "MISMATCH_REJECTED",
  /** Type 1 and 3: the first weight is saved. */
  "FIRST_WEIGHT_SAVED",
  /** Type 2, and any truck without an invoice: the first weight is held for the store officer. */
  "FIRST_WEIGHT_HELD",
  /** An empty truck: its one weight is saved and the visit is over. */
  "EMPTY_WEIGHT_SAVED",
  "STORE_APPROVED",
  "STORE_REJECTED",
  /** Type 1, after the first weight: a supervisor must check the truck. */
  "SUPERVISOR_REQUESTED",
  /** Type 2 and 3, after the first weight: no supervisor check. */
  "SECOND_WEIGHT_ALLOWED",
  "SUPERVISOR_APPROVED",
  "SUPERVISOR_REJECTED",
  "SECOND_WEIGHT_PASSED",
  /** Tolerance failed, or the weights are not valid. */
  "SECOND_WEIGHT_FAILED",
  "HOLD_APPROVED",
  "HOLD_REJECTED",
  /** The blocked-plate check: the store officer's answer to its PLATE_WARNING. */
  "PLATE_WARNING_APPROVED",
  "PLATE_WARNING_REJECTED",
  /** No activity for 10 minutes before the first weight, while it was the driver's turn. */
  "ABANDON",
  /** The store officer ends a visit that is waiting for a person, with a reason. */
  "STORE_CANCELLED",
] as const;
export type TicketEvent = (typeof TICKET_EVENTS)[number];

/** Every allowed move. Anything not listed here is refused. */
export const TICKET_TRANSITIONS: Readonly<
  Record<TicketStatus, Readonly<Partial<Record<TicketEvent, TicketStatus>>>>
> = {
  STARTED: {
    MISMATCH_LIMIT_REACHED: "MISMATCH_PENDING",
    FIRST_WEIGHT_SAVED: "READY_FOR_UNLOAD",
    FIRST_WEIGHT_HELD: "STORE_PENDING",
    EMPTY_WEIGHT_SAVED: "COMPLETED",
    PLATE_WARNING_APPROVED: "STARTED",
    PLATE_WARNING_REJECTED: "REJECTED",
    ABANDON: "ABANDONED",
    STORE_CANCELLED: "ABANDONED",
  },
  MISMATCH_PENDING: {
    STORE_CANCELLED: "ABANDONED",
    MISMATCH_RESOLVED: "STARTED",
    MISMATCH_REJECTED: "REJECTED",
    // The officer may answer the plate warning while the mismatch is still open.
    PLATE_WARNING_APPROVED: "MISMATCH_PENDING",
    PLATE_WARNING_REJECTED: "REJECTED",
  },
  STORE_PENDING: {
    STORE_APPROVED: "READY_FOR_UNLOAD",
    STORE_REJECTED: "REJECTED",
    STORE_CANCELLED: "ABANDONED",
  },
  READY_FOR_UNLOAD: {
    SUPERVISOR_REQUESTED: "SUPERVISOR_PENDING",
    SECOND_WEIGHT_ALLOWED: "READY_FOR_SECOND",
  },
  SUPERVISOR_PENDING: {
    SUPERVISOR_APPROVED: "READY_FOR_SECOND",
    SUPERVISOR_REJECTED: "BLOCKED",
    STORE_CANCELLED: "ABANDONED",
  },
  READY_FOR_SECOND: {
    SECOND_WEIGHT_PASSED: "COMPLETED",
    SECOND_WEIGHT_FAILED: "HOLD_PENDING",
  },
  HOLD_PENDING: {
    HOLD_APPROVED: "COMPLETED",
    HOLD_REJECTED: "REJECTED",
    STORE_CANCELLED: "ABANDONED",
  },
  COMPLETED: {},
  REJECTED: {},
  BLOCKED: {},
  ABANDONED: {},
};

/**
 * Where the blocked-plate check stands for a ticket: not needed, or the state of its
 * PLATE_WARNING request. (The front/back mismatch warning never goes here: it does not block.)
 */
export type PlateCheck = "NOT_NEEDED" | ApprovalStatus;

export interface TransitionContext {
  /** Required for the first weight. */
  plateCheck?: PlateCheck;
}

const FIRST_WEIGHT_EVENTS: ReadonlySet<TicketEvent> = new Set([
  "FIRST_WEIGHT_SAVED",
  "FIRST_WEIGHT_HELD",
  "EMPTY_WEIGHT_SAVED",
]);

export class WrongStageError extends Error {
  override name = "WrongStageError";
  readonly code = "WRONG_STAGE";

  constructor(
    readonly status: TicketStatus,
    readonly event: TicketEvent,
    message = `${event} is not allowed while the ticket is ${status}.`,
  ) {
    super(message);
  }
}

/**
 * The status after `event`, or a WrongStageError (code WRONG_STAGE).
 *
 * The first weight also needs `context.plateCheck` to be NOT_NEEDED or APPROVED.
 * Leaving it out is refused, so a forgotten check cannot let a blocked truck through.
 * The ticket type is not checked here: pick events with firstWeightEvent() and
 * afterFirstWeightEvent().
 */
export function transition(
  current: TicketStatus,
  event: TicketEvent,
  context: TransitionContext = {},
): TicketStatus {
  const moves = TICKET_TRANSITIONS[current];
  const next = Object.hasOwn(moves, event) ? moves[event] : undefined;
  if (next === undefined) throw new WrongStageError(current, event);

  const { plateCheck } = context;
  if (FIRST_WEIGHT_EVENTS.has(event) && plateCheck !== "NOT_NEEDED" && plateCheck !== "APPROVED") {
    throw new WrongStageError(
      current,
      event,
      "The first weight is not allowed until the store officer approves this plate.",
    );
  }
  return next;
}

export function canTransition(
  current: TicketStatus,
  event: TicketEvent,
  context: TransitionContext = {},
): boolean {
  try {
    transition(current, event, context);
    return true;
  } catch (error) {
    if (error instanceof WrongStageError) return false;
    throw error;
  }
}

export function isClosedStatus(status: TicketStatus): boolean {
  return (CLOSED_TICKET_STATUSES as readonly TicketStatus[]).includes(status);
}

/** A Type 2 weight waits for the store officer, and so does every truck without an invoice. */
export const firstWeightEvent = (type: TicketType, noInvoice = false): TicketEvent =>
  type === "TYPE_2" || noInvoice ? "FIRST_WEIGHT_HELD" : "FIRST_WEIGHT_SAVED";

/** The move out of READY_FOR_UNLOAD. */
export const afterFirstWeightEvent = (type: TicketType): TicketEvent =>
  type === "TYPE_1" ? "SUPERVISOR_REQUESTED" : "SECOND_WEIGHT_ALLOWED";

export const secondWeightEvent = (passed: boolean): TicketEvent =>
  passed ? "SECOND_WEIGHT_PASSED" : "SECOND_WEIGHT_FAILED";

/** These statuses exist only while a person has to decide. */
const PERSON_STATUSES: ReadonlySet<TicketStatus> = new Set([
  "MISMATCH_PENDING",
  "STORE_PENDING",
  "SUPERVISOR_PENDING",
  "HOLD_PENDING",
]);

export interface OpenRequest {
  kind: ApprovalKind;
  plateWarningReason: PlateWarningReason | null;
}

/**
 * Does this request hold a STARTED visit up until a person acts? A driver who asked for
 * help, or whose blocked plate must be allowed, waits. A front/back warning stops nobody.
 */
export const holdsUpDriver = ({ kind, plateWarningReason }: OpenRequest): boolean =>
  kind === "DRIVER_HELP" || plateWarningReason === "BLOCKED_HISTORY";

/**
 * Is the visit waiting for a person's decision (the store officer or the supervisor),
 * rather than for the driver? Such a visit is never abandoned by the clock; the store
 * officer may cancel it. `pending` are the ticket's requests nobody has answered.
 */
export function waitsForPerson(status: TicketStatus, pending: readonly OpenRequest[]): boolean {
  return PERSON_STATUSES.has(status) || (status === "STARTED" && pending.some(holdsUpDriver));
}

export const PLATE_BLOCK_HOURS = 24;

export interface PreviousTicket {
  status: TicketStatus;
  /** When it reached its closed status. */
  closedAt: Date | null;
}

/**
 * Does a new ticket for this plate need the store officer's approval before the first
 * weight? Yes if the plate had a BLOCKED or REJECTED ticket closed in the last 24 hours
 * (exactly 24 hours ago still counts). An unknown closing time counts as recent.
 */
export function needsPlateApproval(previousTickets: readonly PreviousTicket[], now: Date): boolean {
  const since = now.getTime() - PLATE_BLOCK_HOURS * 60 * 60 * 1000;
  return previousTickets.some(({ status, closedAt }) => {
    if (status !== "BLOCKED" && status !== "REJECTED") return false;
    const closed = closedAt?.getTime() ?? Number.NaN;
    return Number.isNaN(closed) || closed >= since;
  });
}
