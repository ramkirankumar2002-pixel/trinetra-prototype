// A ticket as the screens see it: the row, its requests, photos and timeline.
import type {
  ApprovalView,
  InvoiceState,
  PlateCheck,
  TicketView,
  TicketWarning,
  TimelineEntry,
} from "@trinetra/shared";
import { asc, eq, inArray } from "drizzle-orm";
import { INVOICE_READ_STALE_MS } from "../config/limits";
import { materials, photos, ticketEvents, unloadingPoints, users } from "../db/schema";
import { approvals } from "../db/schema";
import type { StorageService } from "../services/storage";
import { PHOTO_LINK_SECONDS } from "./photo-links";
import { getTicket, type ApprovalRow, type Reader, type TicketRow } from "./repo";

export const WARNING_EVENTS: Record<string, TicketWarning["type"]> = {
  INVOICE_DUPLICATE: "DUPLICATE_INVOICE",
  INVOICE_VEHICLE_MISMATCH: "INVOICE_VEHICLE_MISMATCH",
};

export const HOLD_REASONS = {
  invalid: "weights not valid",
  noInvoice: "no invoice weight",
  tolerance: "weight does not match the invoice",
} as const;

/** Why a ticket was put on hold, worked out from the weights that were saved. */
export function holdReasonOf(
  ticket: Pick<TicketRow, "netKg" | "invoiceWeightKg">,
  wasHeld: boolean,
): string | null {
  if (!wasHeld) return null;
  if (ticket.netKg === null || ticket.netKg <= 0) return HOLD_REASONS.invalid;
  return ticket.invoiceWeightKg === null ? HOLD_REASONS.noInvoice : HOLD_REASONS.tolerance;
}

/** The accepted weight of a completed ticket. */
export function finalWeightOf(
  ticket: Pick<TicketRow, "status" | "netKg" | "invoiceWeightKg">,
  requests: Pick<ApprovalRow, "kind" | "status" | "chosenWeight">[],
): number | null {
  if (ticket.status !== "COMPLETED") return null;
  const hold = requests.find((row) => row.kind === "HOLD" && row.status === "APPROVED");
  return hold?.chosenWeight === "INVOICE_WEIGHT" ? ticket.invoiceWeightKg : ticket.netKg;
}

/** The newest blocked-plate request decides. The front/back warning never counts. */
function plateCheckFrom(requests: ApprovalRow[]): PlateCheck {
  return (
    requests.filter((row) => row.plateWarningReason === "BLOCKED_HISTORY").at(-1)?.status ??
    "NOT_NEEDED"
  );
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

const INVOICE_EVENTS = ["INVOICE_RECEIVED", "INVOICE_READ", "INVOICE_READ_FAILED"];

/** Where the newest upload stands, from the timeline (oldest event first). */
export function invoiceProgress(
  events: { type: string; data: Record<string, unknown>; createdAt: Date }[],
  now = new Date(),
): { state: InvoiceState; error: string | null } {
  const last = events.filter((row) => INVOICE_EVENTS.includes(row.type)).pop();
  if (!last) return { state: "none", error: null };
  if (last.type === "INVOICE_READ") return { state: "read", error: null };
  if (last.type === "INVOICE_READ_FAILED") {
    return { state: "failed", error: String(last.data.error) };
  }
  // The server stopped while reading: the result will never come.
  return now.getTime() - last.createdAt.getTime() > INVOICE_READ_STALE_MS
    ? { state: "failed", error: "INTERRUPTED" }
    : { state: "reading", error: null };
}

export async function userNames(db: Reader, ids: number[]) {
  const rows = ids.length === 0 ? [] : await db.select().from(users).where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

const userIdOf = (actor: string) =>
  actor.startsWith("user:") ? Number(actor.slice("user:".length)) : undefined;

export async function materialNames(db: Reader) {
  const rows = await db.select({ id: materials.id, name: materials.name }).from(materials);
  return new Map(rows.map((row) => [row.id, row.name]));
}

export function approvalView(
  row: ApprovalRow,
  names: Map<number, { name: string }>,
  materialsById: Map<number, string>,
): ApprovalView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    plateWarningReason: row.plateWarningReason,
    reason: row.reason,
    chosenWeight: row.chosenWeight,
    chosenMaterial: row.chosenMaterialId ? (materialsById.get(row.chosenMaterialId) ?? null) : null,
    decidedBy: row.decidedBy ? (names.get(row.decidedBy)?.name ?? null) : null,
    plateRead: row.plateRead,
    plateMatch: row.plateMatch,
    matchResult: row.matchResult,
    plateConfidence: row.plateConfidence,
    captureSource: row.captureSource,
    manualPlate: row.manualPlate,
    photoId: row.photoId,
    gps: row.gps,
    createdAt: row.createdAt.toISOString(),
    decidedAt: iso(row.decidedAt),
  };
}

/** Everything about a ticket, from the database. */
async function loadTicket(db: Reader, ticketId: number) {
  const ticket = await getTicket(db, ticketId);
  // One after another: inside a transaction there is only one connection.
  const requests = await db
    .select()
    .from(approvals)
    .where(eq(approvals.ticketId, ticketId))
    .orderBy(asc(approvals.id));
  const events = await db
    .select()
    .from(ticketEvents)
    .where(eq(ticketEvents.ticketId, ticketId))
    .orderBy(asc(ticketEvents.id));
  const pictures = await db
    .select()
    .from(photos)
    .where(eq(photos.ticketId, ticketId))
    .orderBy(asc(photos.takenAt));
  const materialsById = await materialNames(db);
  const [point] = ticket.unloadingPointId
    ? await db.select().from(unloadingPoints).where(eq(unloadingPoints.id, ticket.unloadingPointId))
    : [];

  const names = await userNames(db, [
    ...new Set(
      [
        ticket.supervisorId,
        ...requests.map((row) => row.decidedBy),
        ...events.map((row) => userIdOf(row.actor)),
      ].filter((id): id is number => typeof id === "number"),
    ),
  ]);
  return { ticket, requests, events, pictures, materialsById, point, names };
}

export async function ticketView(
  db: Reader,
  storage: StorageService,
  ticketId: number,
): Promise<TicketView> {
  // One snapshot for all the reads: otherwise a save in between could, for example, show
  // an invoice as read while its values are still the old ones.
  const { ticket, requests, events, pictures, materialsById, point, names } = await db.transaction(
    (tx) => loadTicket(tx, ticketId),
    { isolationLevel: "repeatable read" },
  );
  const supervisor = ticket.supervisorId ? names.get(ticket.supervisorId) : undefined;

  const actorName = (actor: string) => {
    const id = userIdOf(actor);
    if (id !== undefined) return names.get(id)?.name ?? "Unknown user";
    return actor === "system" ? "System" : actor.slice("device:".length);
  };
  const timeline: TimelineEntry[] = events.map((row) => ({
    type: row.type,
    at: row.createdAt.toISOString(),
    actor: row.actor,
    actorName: actorName(row.actor),
    data: row.data,
  }));

  return {
    id: ticket.id,
    ticketNo: ticket.ticketNo,
    plate: ticket.plate,
    status: ticket.status,
    type: ticket.type,
    language: ticket.language,
    material: ticket.materialId ? (materialsById.get(ticket.materialId) ?? null) : null,
    supplier: ticket.supplier,
    transporter: ticket.transporter,
    invoice: {
      number: ticket.invoiceNo,
      material: ticket.invoiceMaterial,
      date: ticket.invoiceDate,
      weightKg: ticket.invoiceWeightKg,
      ...invoiceProgress(events),
    },
    heldWeightKg: ticket.heldWeightKg,
    firstWeightKg: ticket.firstWeightKg,
    secondWeightKg: ticket.secondWeightKg,
    netKg: ticket.netKg,
    variancePct: ticket.variancePct,
    finalWeightKg: finalWeightOf(ticket, requests),
    tripNo: ticket.tripNo,
    unloadingPoint: point ? { code: point.code, name: point.name } : null,
    supervisor: supervisor
      ? { id: supervisor.id, name: supervisor.name, phone: supervisor.phone }
      : null,
    driverName: ticket.driverName,
    driverPhone: ticket.driverPhone,
    mismatchAttempts: ticket.mismatchAttempts,
    isDemo: ticket.isDemo,
    plateCheck: plateCheckFrom(requests),
    holdReason: holdReasonOf(
      ticket,
      requests.some((row) => row.kind === "HOLD"),
    ),
    warnings: events
      .filter((row) => Object.hasOwn(WARNING_EVENTS, row.type))
      .map((row) => ({
        type: WARNING_EVENTS[row.type]!,
        message: String(row.data.message ?? ""),
        at: row.createdAt.toISOString(),
      })),
    createdAt: ticket.createdAt.toISOString(),
    firstWeightAt: iso(ticket.firstWeightAt),
    secondWeightAt: iso(ticket.secondWeightAt),
    closedAt: iso(ticket.closedAt),
    approvals: requests.map((row) => approvalView(row, names, materialsById)),
    photos: await Promise.all(
      pictures.map(async (row) => ({
        id: row.id,
        kind: row.kind,
        url: await storage.getUrl(row.storagePath, PHOTO_LINK_SECONDS),
        takenAt: row.takenAt.toISOString(),
      })),
    ),
    timeline,
  };
}
