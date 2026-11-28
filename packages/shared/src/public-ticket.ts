// What anyone with a slip's QR code may see (GET /api/public/tickets/:token). It is a
// list of named fields and named steps: nothing else of a ticket ever leaves the backend
// without a login.
import type { TicketStatus, TicketType } from "./domain";

/** 32 hex digits: the random address of a ticket's public page. */
export const PUBLIC_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** The address of a ticket's public page on the website, as the slip's QR code holds it. */
export const publicTicketPath = (token: string) => `/t/${token}`;

export const PUBLIC_STEPS = [
  "ARRIVED",
  "PLATE_READ",
  "BILL_READ",
  "FIRST_WEIGHT",
  /** The store officer allowed a plate that had been turned away earlier. */
  "PLATE_ALLOWED",
  /** The store officer chose the material after it did not match the bill. */
  "MATERIAL_SET",
  "SUPERVISOR_APPROVED",
  "SUPERVISOR_REJECTED",
  /** The store officer approved a Type 2 truck. */
  "STORE_APPROVED",
  "SECOND_WEIGHT",
  "ON_HOLD",
  /** The store officer accepted a weight that did not match. */
  "HOLD_APPROVED",
  "STORE_REJECTED",
  "COMPLETED",
  "CANCELLED",
  "ABANDONED",
] as const;
export type PublicStepName = (typeof PUBLIC_STEPS)[number];

export interface PublicTimelineStep {
  step: PublicStepName;
  at: string;
  /** The member of staff who did it: a name and a role, nothing else. */
  by: { name: string; role: "SUPERVISOR" | "STORE" } | null;
  /** The weight this step took or accepted. */
  kg: number | null;
  /** Why it was rejected or cancelled. Anything like a phone number is hidden. */
  reason: string | null;
  /** The plate was typed by the driver, or approved although the photo did not match. */
  manual: boolean;
}

export interface PublicTicketView {
  ticketNo: string;
  plate: string;
  status: TicketStatus;
  type: TicketType | null;
  material: string | null;
  invoiceNo: string | null;
  invoiceWeightKg: number | null;
  firstWeightKg: number | null;
  secondWeightKg: number | null;
  netKg: number | null;
  variancePct: number | null;
  /** The accepted weight of a completed ticket. */
  finalWeightKg: number | null;
  /** The point's name only, such as "Valley Crossing". */
  unloadingPoint: { code: string; name: string } | null;
  isDemo: boolean;
  createdAt: string;
  /** The front camera's newest photo of the truck: a link that works for a few minutes. */
  frontPhoto: { url: string; takenAt: string } | null;
  /** Oldest first. */
  timeline: PublicTimelineStep[];
}
