// Fixed value lists from build plan sections 5 and 6. The database enums are built from these,
// so the database, the backend and the website cannot drift apart.

export const TICKET_STATUSES = [
  "STARTED",
  "MISMATCH_PENDING",
  "STORE_PENDING",
  "READY_FOR_UNLOAD",
  "SUPERVISOR_PENDING",
  "READY_FOR_SECOND",
  "HOLD_PENDING",
  "COMPLETED",
  "REJECTED",
  "BLOCKED",
  "ABANDONED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** A ticket in any other status is "open". Only one open ticket is allowed per plate. */
export const CLOSED_TICKET_STATUSES = [
  "COMPLETED",
  "REJECTED",
  "BLOCKED",
  "ABANDONED",
] as const satisfies readonly TicketStatus[];

/** TYPE_1: supervisor check. TYPE_2: store officer check. TYPE_3: normal, no human check. */
export const TICKET_TYPES = ["TYPE_1", "TYPE_2", "TYPE_3"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/**
 * What the driver says is on the truck. An EMPTY ticket is weighed once, for the record:
 * no invoice, no material, no approvals.
 */
export const TICKET_LOADS = ["LOADED", "EMPTY"] as const;
export type TicketLoad = (typeof TICKET_LOADS)[number];

/** A truck blocked by a supervisor is a REJECTED approval of kind SUPERVISOR. */
export const APPROVAL_KINDS = [
  "STORE_TYPE2",
  "SUPERVISOR",
  "HOLD",
  "MISMATCH",
  "DRIVER_HELP",
  "PLATE_WARNING",
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/**
 * Why a PLATE_WARNING request exists. BLOCKED_HISTORY stops the first weight until the store
 * officer approves it. FRONT_BACK_MISMATCH is only a warning and never blocks.
 */
export const PLATE_WARNING_REASONS = ["BLOCKED_HISTORY", "FRONT_BACK_MISMATCH"] as const;
export type PlateWarningReason = (typeof PLATE_WARNING_REASONS)[number];

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Which weight the store officer accepts when deciding a HOLD. */
export const HOLD_WEIGHT_CHOICES = ["MEASURED_NET", "INVOICE_WEIGHT"] as const;
export type HoldWeightChoice = (typeof HOLD_WEIGHT_CHOICES)[number];

export const USER_ROLES = ["KIOSK", "SUPERVISOR", "STORE"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PHOTO_KINDS = ["FRONT_PLATE", "BACK_PLATE", "INVOICE", "SUPERVISOR", "STORE"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/**
 * How the supervisor's photo compares with the ticket's plate. CLOSE is one character
 * different. MANUAL is set at the decision: the photo could not be read, and the
 * supervisor typed the plate they saw.
 */
export const PLATE_MATCH_RESULTS = ["MATCH", "CLOSE", "NO_MATCH", "NOT_READ", "MANUAL"] as const;
export type PlateMatchResult = (typeof PLATE_MATCH_RESULTS)[number];

/** The in-page camera, or the phone's own camera app where the page cannot open one. */
export const CAPTURE_SOURCES = ["camera", "fallback"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export const LANGUAGES = ["en", "hi"] as const;
export type Language = (typeof LANGUAGES)[number];
