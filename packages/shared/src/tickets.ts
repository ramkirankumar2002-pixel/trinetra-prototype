// The ticket API (build plan sections 6 and 7): what the website sends and gets back.
// No request carries a weight: the backend takes every weight from the weighbridge itself.
import { z } from "zod";
import {
  LANGUAGES,
  type ApprovalKind,
  type ApprovalStatus,
  type HoldWeightChoice,
  type Language,
  type PhotoKind,
  type PlateWarningReason,
  type TicketStatus,
  type TicketType,
} from "./domain";
import type { PlateRead, ReadSource } from "./readers";
import { isValidIndianPlate, normalizePlate } from "./rules/plates";
import type { PlateCheck } from "./rules/ticket-state";

export const plateSchema = z
  .string()
  .max(20)
  .transform(normalizePlate)
  .refine(isValidIndianPlate, "Enter a full number plate, such as MH 12 AB 1234.");

const id = z.number().int().positive();

export const createTicketSchema = z.strictObject({
  plate: plateSchema,
  language: z.enum(LANGUAGES),
  /** The ids POST /api/anpr returned. */
  photoIds: z.array(z.uuid()).max(12).default([]),
  /** The driver typed the plate on the keypad. Marked on the timeline. */
  manual: z.boolean().default(false),
});
export type CreateTicketRequest = z.input<typeof createTicketSchema>;

const shortText = z.string().trim().min(1).max(100);

/** An Indian mobile number: 10 digits, starting 6 to 9. */
export const DRIVER_PHONE_PATTERN = /^[6-9]\d{9}$/;

export const ticketDetailsSchema = z
  .strictObject({
    /** A material name from the list. */
    material: shortText,
    supplier: shortText,
    transporter: shortText,
    driverName: shortText,
    driverPhone: z.string().regex(DRIVER_PHONE_PATTERN, "Enter a 10 digit mobile number."),
    /** The driver switched language: the phone's upload page follows the ticket. */
    language: z.enum(LANGUAGES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Send at least one value.");
export type TicketDetailsRequest = z.input<typeof ticketDetailsSchema>;

export const SLIP_KINDS = ["FIRST", "FINAL", "REPRINT"] as const;
export type SlipKind = (typeof SLIP_KINDS)[number];
export const printedSchema = z.strictObject({ kind: z.enum(SLIP_KINDS) });

/** For POSTs that take no values. Anything sent, such as a weight, is refused. */
export const emptyBodySchema = z.strictObject({}).optional().nullable();

export const WEIGHT_CHOICES = ["NET", "INVOICE"] as const;
/** The store officer's choice on a HOLD. It picks a number the backend already has. */
export type WeightChoice = (typeof WEIGHT_CHOICES)[number];

export const decideSchema = z
  .strictObject({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().min(1).max(300).optional(),
    chosenWeight: z.enum(WEIGHT_CHOICES).optional(),
    chosenMaterial: shortText.optional(),
    /** Supervisor only: approve although the photo does not match. Needs a note. */
    manualCheck: z.boolean().optional(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .refine((value) => value.decision !== "REJECT" || value.reason !== undefined, {
    path: ["reason"],
    message: "A rejection needs a reason.",
  });
export type DecideRequest = z.input<typeof decideSchema>;

export const helpSchema = z.strictObject({ ticketId: id.optional() }).optional().nullable();

export const listStatusSchema = z.object({
  status: z.enum(["pending", "done"]).default("pending"),
});

export const supervisorPhotoFieldsSchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    accuracyM: z.coerce.number().min(0).max(100_000),
  })
  .partial()
  .refine(
    (value) => (value.lat === undefined) === (value.lng === undefined),
    "Send both lat and lng, or neither.",
  );

export const demoSettingsSchema = z
  .strictObject({
    anprMode: z.enum(["real", "pick"]),
    ocrMode: z.enum(["real", "pick"]),
    demoPlate: plateSchema,
    demoInvoice: z.string().max(40),
    /** "real" hands the weight back to the ESP32. Simulated starts with POST /api/demo/weight. */
    weightMode: z.literal("real"),
  })
  .partial();

export const demoWeightSchema = z.strictObject({
  kg: z.number().int().min(0).max(200_000),
  stable: z.boolean().default(true),
  positionOk: z.boolean().default(true),
});

export interface DemoSettings {
  anprMode: "real" | "pick";
  ocrMode: "real" | "pick";
  demoPlate: string | null;
  demoInvoice: string | null;
  weightMode: "real" | "simulated";
  simulatedWeight: { kg: number; stable: boolean; positionOk: boolean } | null;
}

export interface OpenTicket {
  id: number;
  ticketNo: string;
  plate: string;
  status: TicketStatus;
  language: Language;
}

export interface AnprCameraResult extends Pick<
  PlateRead,
  "plate" | "source" | "confidence" | "validFormat"
> {
  photoId: string | null;
  photoUrl: string | null;
  cameraFailure: "OFFLINE" | "TIMEOUT" | "SAVE_FAILED" | null;
}

export interface AnprResponse {
  /** 1 for the first read of this truck. */
  attempt: number;
  /** How many more times the kiosk should read again while the plates differ. */
  retriesLeft: number;
  front: AnprCameraResult;
  back: AnprCameraResult;
  sources: { front: ReadSource | null; back: ReadSource | null };
  match: boolean;
  /** The plate both cameras agree on. */
  plate: string | null;
  /**
   * The driver may now confirm a plate: both cameras agree, or the retries are used up.
   * Even a confident read must be confirmed by the driver.
   */
  canConfirm: boolean;
  photoIds: string[];
  demo: boolean;
  openTicket: OpenTicket | null;
  /**
   * With no open ticket: this plate's ticket that a supervisor blocked in the last 24
   * hours. The kiosk says the truck was not approved.
   */
  blockedTicket: OpenTicket | null;
}

export interface PhotoView {
  id: string;
  kind: PhotoKind;
  /** Works for a few minutes only. */
  url: string;
  takenAt: string;
}

export interface TimelineEntry {
  type: string;
  at: string;
  /** "system", "device:<name>" or "user:<id>". */
  actor: string;
  actorName: string;
  data: Record<string, unknown>;
}

export interface ApprovalView {
  id: number;
  kind: ApprovalKind;
  status: ApprovalStatus;
  plateWarningReason: PlateWarningReason | null;
  reason: string | null;
  chosenWeight: HoldWeightChoice | null;
  chosenMaterial: string | null;
  decidedBy: string | null;
  plateRead: string | null;
  plateMatch: boolean | null;
  photoId: string | null;
  gps: { lat: number; lng: number; accuracyM?: number } | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface TicketView {
  id: number;
  ticketNo: string;
  plate: string;
  status: TicketStatus;
  type: TicketType | null;
  language: Language;
  material: string | null;
  supplier: string | null;
  transporter: string | null;
  invoice: {
    number: string | null;
    material: string | null;
    date: string | null;
    weightKg: number | null;
    state: InvoiceState;
    /** With "failed": an error code such as READER_BUSY or INTERRUPTED. */
    error: string | null;
  };
  /** Type 2 only: the first weight while the store officer decides. */
  heldWeightKg: number | null;
  firstWeightKg: number | null;
  secondWeightKg: number | null;
  netKg: number | null;
  variancePct: number | null;
  /** The accepted weight of a completed ticket: the net, or what the store officer chose. */
  finalWeightKg: number | null;
  tripNo: number | null;
  unloadingPoint: { code: string; name: string } | null;
  supervisor: { id: number; name: string; phone: string | null } | null;
  driverName: string | null;
  driverPhone: string | null;
  mismatchAttempts: number;
  isDemo: boolean;
  /** Anything but NOT_NEEDED or APPROVED blocks the first weight. */
  plateCheck: PlateCheck;
  /** Why the ticket is on hold. */
  holdReason: string | null;
  warnings: TicketWarning[];
  createdAt: string;
  firstWeightAt: string | null;
  secondWeightAt: string | null;
  closedAt: string | null;
  approvals: ApprovalView[];
  photos: PhotoView[];
  timeline: TimelineEntry[];
}

export interface TicketWarning {
  type: "DUPLICATE_INVOICE" | "INVOICE_VEHICLE_MISMATCH";
  message: string;
  at: string;
}

export interface CreateTicketResponse {
  /** True if the driver's open STARTED ticket was continued. */
  resumed: boolean;
  ticket: TicketView;
}

export interface DetailsResponse {
  /** False if the material did not match the invoice. Nothing else is refused. */
  materialMatched: boolean;
  /** Tries left before the store officer must decide. */
  attemptsLeft: number;
  ticket: TicketView;
}

export interface UploadLinkResponse {
  code: string;
  /** What the kiosk shows as a QR code. */
  url: string;
  expiresAt: string;
}

/** All the driver's phone is told: enough to know it is the right truck. */
export interface UploadInfoResponse {
  plate: string;
  language: Language;
  expiresAt: string;
}

/** The answer to the phone (202): the file is saved, and is read after this answer. */
export interface UploadResponse {
  ok: true;
  status: "received";
}

/** Where the reading of the newest invoice stands. */
export type InvoiceState = "none" | "reading" | "read" | "failed";

export interface StoreRequestView {
  approval: ApprovalView;
  ticket: {
    id: number;
    ticketNo: string;
    plate: string;
    status: TicketStatus;
    type: TicketType | null;
    material: string | null;
    supplier: string | null;
    invoiceWeightKg: number | null;
    heldWeightKg: number | null;
    firstWeightKg: number | null;
    secondWeightKg: number | null;
    netKg: number | null;
    variancePct: number | null;
    holdReason: string | null;
    isDemo: boolean;
  } | null;
}

export interface StoreRequestsResponse {
  requests: StoreRequestView[];
  /** Warnings of the last 24 hours that need no decision, such as a repeated invoice. */
  warnings: (TicketWarning & { ticketId: number; ticketNo: string; plate: string })[];
}

export interface SupervisorTicketView {
  approvalId: number;
  approvalStatus: ApprovalStatus;
  decidedAt: string | null;
  ticketId: number;
  ticketNo: string;
  plate: string;
  status: TicketStatus;
  material: string | null;
  supplier: string | null;
  invoiceWeightKg: number | null;
  unloadingPoint: { code: string; name: string } | null;
  firstWeightAt: string | null;
  plateRead: string | null;
  plateMatch: boolean | null;
  photosUsed: number;
}

export const MAX_SUPERVISOR_PHOTOS = 3;

export interface SupervisorPhotoResponse {
  photoId: string;
  plateRead: string | null;
  match: boolean;
  photosUsed: number;
  photosLeft: number;
}

export interface PublicTicketView {
  ticketNo: string;
  plate: string;
  status: TicketStatus;
  type: TicketType | null;
  material: string | null;
  supplier: string | null;
  transporter: string | null;
  invoiceNo: string | null;
  invoiceWeightKg: number | null;
  firstWeightKg: number | null;
  secondWeightKg: number | null;
  netKg: number | null;
  variancePct: number | null;
  finalWeightKg: number | null;
  tripNo: number | null;
  unloadingPoint: { code: string; name: string } | null;
  isDemo: boolean;
  createdAt: string;
  firstWeightAt: string | null;
  secondWeightAt: string | null;
  closedAt: string | null;
  timeline: { type: string; at: string; actorName: string; data: Record<string, unknown> }[];
  photos: Omit<PhotoView, "id">[];
}

export interface LiveSummaryResponse {
  /** Tickets started today (India time). */
  trucksToday: number;
  /** Accepted weight of the tickets completed today. */
  kgByMaterial: { material: string; kg: number }[];
  pendingApprovals: number;
  /** Tickets that ended blocked or rejected today. */
  blockedOrRejected: number;
  devicesOnline: { main: boolean; front: boolean; back: boolean };
}

/** GET /api/master: what the kiosk's tiles are made from. */
export interface MasterResponse {
  materials: {
    name: string;
    /** The type without a weight rule. */
    type: TicketType;
    /** If set, the invoice weight is needed to decide the type. */
    type2AboveKg: number | null;
    aliasesEn: string[];
    aliasesHi: string[];
  }[];
  suppliers: string[];
  transporters: string[];
}

/** GET /api/kiosk/collect: the two lists of the kiosk's Ready screen. */
export interface KioskCollectResponse {
  /** Approved by the store officer, and the slip not yet printed. Newest first. */
  ready: { ticketId: number; ticketNo: string; plate: string; slip: "FIRST" | "FINAL" }[];
  /** Turned away in the last 10 minutes. */
  notApproved: { ticketId: number; plate: string; until: string }[];
}
