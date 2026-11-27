// What the store officer's pages work out from the backend's answers. The backend makes
// every judgement (the weights, the tolerance, who may decide): this only words them.
import type {
  ApprovalKind,
  PhotoKind,
  PhotoView,
  PlateWarningReason,
  StoreTicketView,
  TicketStatus,
  TicketView,
} from "@trinetra/shared";
import type { Tone } from "@/components/ui/tone";
import type { MessageKey, MessageParams } from "@/i18n/translate";

// ---- The queue ----

export const REQUEST_FILTERS = ["all", "type2", "hold", "mismatch", "help", "plate"] as const;
export type RequestFilter = (typeof REQUEST_FILTERS)[number];

export const FILTER_KEYS: Record<RequestFilter, MessageKey> = {
  all: "store.filter.all",
  type2: "store.filter.type2",
  hold: "store.filter.hold",
  mismatch: "store.filter.mismatch",
  help: "store.filter.help",
  plate: "store.filter.plate",
};

const FILTER_OF: Record<ApprovalKind, RequestFilter> = {
  STORE_TYPE2: "type2",
  HOLD: "hold",
  MISMATCH: "mismatch",
  DRIVER_HELP: "help",
  PLATE_WARNING: "plate",
  // Never waits for the store officer.
  SUPERVISOR: "all",
};

export const matchesFilter = (filter: RequestFilter, kind: ApprovalKind): boolean =>
  filter === "all" || FILTER_OF[kind] === filter;

interface RequestKind {
  kind: ApprovalKind;
  plateWarningReason: PlateWarningReason | null;
}

export function kindPill({ kind, plateWarningReason }: RequestKind): {
  tone: Tone;
  key: MessageKey;
} {
  if (kind === "STORE_TYPE2") return { tone: "info", key: "store.kind.type2" };
  if (kind === "HOLD") return { tone: "wait", key: "store.kind.hold" };
  if (kind === "MISMATCH") return { tone: "stop", key: "store.kind.mismatch" };
  if (kind === "DRIVER_HELP") return { tone: "info", key: "store.kind.help" };
  if (kind === "SUPERVISOR") return { tone: "stop", key: "store.kind.supervisor" };
  return plateWarningReason === "BLOCKED_HISTORY"
    ? { tone: "stop", key: "store.kind.blocked" }
    : { tone: "wait", key: "store.kind.frontBack" };
}

export const AMBER_AFTER_MIN = 5;
export const RED_AFTER_MIN = 10;

/** How loudly a wait is shown: amber after more than 5 minutes, red after more than 10. */
export function waitTone(minutes: number): Tone {
  if (minutes >= RED_AFTER_MIN) return "stop";
  return minutes >= AMBER_AFTER_MIN ? "wait" : "idle";
}

/** Whole minutes and the seconds beyond them, so "more than 5 minutes" is exact. */
export function waitingFor(from: string, now: number): { minutes: number; tone: Tone } | null {
  if (now === 0) return null;
  const ms = Math.max(0, now - Date.parse(from));
  const minutes = Math.floor(ms / 60_000);
  return { minutes, tone: waitTone(ms / 60_000) };
}

// ---- One ticket ----

/** The newest photo of a kind. */
export const latestPhoto = (ticket: TicketView, kind: PhotoKind): PhotoView | undefined =>
  ticket.photos.filter((photo) => photo.kind === kind).at(-1);

const lastEvent = (ticket: TicketView, type: string) =>
  ticket.timeline.filter((entry) => entry.type === type).at(-1);

const textOf = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
const numberOf = (value: unknown) => (typeof value === "number" ? value : null);

export interface InvoiceAsRead {
  invoiceNo: string | null;
  material: string | null;
  supplier: string | null;
  weightKg: number | null;
  /** "gemini" or "demo". */
  source: string | null;
  model: string | null;
  warnings: string[];
}

/**
 * What the reader took from the newest bill, as it was saved then. The ticket's own
 * supplier may since have been changed by the driver.
 */
export function invoiceAsRead(ticket: TicketView): InvoiceAsRead | null {
  const data = lastEvent(ticket, "INVOICE_READ")?.data;
  if (!data) return null;
  return {
    invoiceNo: textOf(data.invoiceNo),
    material: textOf(data.material),
    supplier: textOf(data.supplier),
    weightKg: numberOf(data.weightKg),
    source: textOf(data.source),
    model: textOf(data.model),
    warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [],
  };
}

/** The file that was read, or the newest one if none has been. */
export function invoiceFile(ticket: TicketView): PhotoView | undefined {
  const read = lastEvent(ticket, "INVOICE_READ")?.data.photoId;
  return ticket.photos.find((photo) => photo.id === read) ?? latestPhoto(ticket, "INVOICE");
}

/** Photo links are signed addresses: the file's type is in the part before the "?". */
export const isPdf = (url: string): boolean => url.split("?")[0]!.toLowerCase().endsWith(".pdf");

export interface HoldSum {
  invoiceKg: number | null;
  firstKg: number | null;
  secondKg: number | null;
  netKg: number | null;
  /** Net minus invoice: negative means less arrived than was billed. */
  differenceKg: number | null;
  variancePct: number | null;
  /** The limit the backend judged by, as it saved it. */
  limitPct: number | null;
}

export function holdSum(ticket: TicketView): HoldSum {
  const { invoice, netKg } = ticket;
  return {
    invoiceKg: invoice.weightKg,
    firstKg: ticket.firstWeightKg,
    secondKg: ticket.secondWeightKg,
    netKg,
    differenceKg: netKg === null || invoice.weightKg === null ? null : netKg - invoice.weightKg,
    variancePct: ticket.variancePct,
    limitPct: numberOf(lastEvent(ticket, "SECOND_WEIGHT_FAILED")?.data.tolerancePct),
  };
}

/** A weight the backend would accept: it refuses a missing one, or zero or less. */
export const canAccept = (kg: number | null): kg is number => kg !== null && kg > 0;

/** "+190 kg", "−190 kg" or "0 kg". */
export function signed(kg: number, format: (kg: number) => string): string {
  if (kg === 0) return format(0);
  return `${kg > 0 ? "+" : "−"}${format(Math.abs(kg))}`;
}

/** What the plate cameras read, and the earlier ticket of a blocked plate. */
export function plateWarningData(ticket: TicketView, approvalId: number) {
  const data = ticket.timeline.find(
    (entry) => entry.type === "APPROVAL_REQUESTED" && entry.data.approvalId === approvalId,
  )?.data;
  return {
    front: textOf(data?.front),
    back: textOf(data?.back),
    earlierTicketNo: textOf(data?.earlierTicketNo),
    earlierStatus: textOf(data?.earlierStatus),
  };
}

/** May the store officer upload a bill for this call? The backend checks this again. */
export const mayUploadBill = (ticket: TicketView | undefined): boolean =>
  ticket?.status === "STARTED" && ticket.invoice.state !== "read";

// ---- Where a truck is ----

export function truckPlace(
  truck: Pick<
    StoreTicketView,
    "status" | "type" | "unloadingPoint" | "supervisor" | "pendingStoreApprovalId"
  >,
): { tone: Tone; key: MessageKey; params: MessageParams } {
  const params = {
    point: truck.unloadingPoint?.code ?? "—",
    name: truck.supervisor ?? "—",
  };
  const place = (tone: Tone, key: MessageKey) => ({ tone, key, params });
  switch (truck.status) {
    case "STARTED":
      return truck.pendingStoreApprovalId === null
        ? place("info", "store.where.answering")
        : place("wait", "store.where.needsYou");
    case "MISMATCH_PENDING":
      return place("wait", "store.where.mismatch");
    case "STORE_PENDING":
      return place("wait", "store.where.aside");
    case "HOLD_PENDING":
      return place("wait", "store.where.hold");
    case "READY_FOR_UNLOAD":
    case "SUPERVISOR_PENDING":
      return place("info", "store.where.supervisor");
    case "READY_FOR_SECOND":
      // A Type 1 truck gets here only after its supervisor's check.
      return truck.type === "TYPE_1"
        ? place("go", "store.where.readySecond")
        : place("info", "store.where.unloadThenSecond");
    // Closed tickets are not on site.
    default:
      return place("idle", STATUS_KEYS[truck.status]);
  }
}

export const STATUS_KEYS: Record<TicketStatus, MessageKey> = {
  STARTED: "store.status.STARTED",
  MISMATCH_PENDING: "store.status.MISMATCH_PENDING",
  STORE_PENDING: "store.status.STORE_PENDING",
  READY_FOR_UNLOAD: "store.status.READY_FOR_UNLOAD",
  SUPERVISOR_PENDING: "store.status.SUPERVISOR_PENDING",
  READY_FOR_SECOND: "store.status.READY_FOR_SECOND",
  HOLD_PENDING: "store.status.HOLD_PENDING",
  COMPLETED: "store.status.COMPLETED",
  REJECTED: "store.status.REJECTED",
  BLOCKED: "store.status.BLOCKED",
  ABANDONED: "store.status.ABANDONED",
};

export const STATUS_TONES: Record<TicketStatus, Tone> = {
  STARTED: "info",
  MISMATCH_PENDING: "wait",
  STORE_PENDING: "wait",
  READY_FOR_UNLOAD: "info",
  SUPERVISOR_PENDING: "wait",
  READY_FOR_SECOND: "info",
  HOLD_PENDING: "wait",
  COMPLETED: "go",
  REJECTED: "stop",
  BLOCKED: "stop",
  ABANDONED: "idle",
};

// ---- Reasons ----

export interface ReasonChip {
  /** Saved in English, whatever the officer's language, so everyone reads the same. */
  value: string;
  key: MessageKey;
}

export const REJECT_CHIPS: readonly ReasonChip[] = [
  { value: "Wrong material", key: "store.reason.wrongMaterial" },
  { value: "Wrong or unclear bill", key: "store.reason.wrongBill" },
  { value: "Weight does not match", key: "store.reason.weight" },
  { value: "Not allowed to enter", key: "store.reason.notAllowed" },
];

export const INVOICE_WEIGHT_CHIPS: readonly ReasonChip[] = [
  { value: "Loss on the way (moisture or spillage)", key: "store.reason.loss" },
  { value: "Weighbridge difference accepted", key: "store.reason.difference" },
  { value: "Checked with the supplier", key: "store.reason.supplier" },
];

export const ALLOW_CHIPS: readonly ReasonChip[] = [
  { value: "Checked the truck in person", key: "store.reason.checked" },
  { value: "Earlier rejection was a mistake", key: "store.reason.mistake" },
  { value: "Problem has been fixed", key: "store.reason.fixed" },
];

/** The supervisor's tapped reasons, so the store officer reads them in their language. */
const SUPERVISOR_CHIPS: readonly ReasonChip[] = [
  { value: "Wrong truck", key: "sup.reason.wrongTruck" },
  { value: "Plate covered/fake", key: "sup.reason.covered" },
  { value: "Material not unloaded", key: "sup.reason.notUnloaded" },
];

const ALL_CHIPS = [...REJECT_CHIPS, ...INVOICE_WEIGHT_CHIPS, ...ALLOW_CHIPS, ...SUPERVISOR_CHIPS];
export const REASON_MAX = 300;

/** The chosen chip, the typed words, or both. Null while there is neither. */
export function reasonOf(chip: string | null, typed: string): string | null {
  const text = [chip, typed.trim()].filter(Boolean).join(": ");
  return text === "" ? null : text.slice(0, REASON_MAX);
}

/** A saved reason in the reader's language, as far as it is one of the chips. */
export function reasonWords(reason: string, t: (key: MessageKey) => string): string {
  for (const { value, key } of ALL_CHIPS) {
    if (reason === value) return t(key);
    if (reason.startsWith(`${value}: `)) return `${t(key)}${reason.slice(value.length)}`;
  }
  return reason;
}

/** Someone has already answered this request, or its truck has moved on. */
export const ALREADY_HANDLED = new Set(["WRONG_STAGE", "ALREADY_DECIDED"]);
