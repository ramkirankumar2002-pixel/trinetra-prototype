// What people without a login may see: the timeline behind the slip's QR code, and the
// live summary for the projector (build plan section 12).
import type { LiveSummaryResponse, PublicTicketView } from "@trinetra/shared";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { approvals, materials, tickets } from "../db/schema";
import { ticketNotFound } from "./repo";
import { pendingApprovals } from "./store";
import { finalWeightOf, ticketView } from "./view";

/**
 * The only timeline values that are shown without a login. A list of what is allowed, so
 * something new (a phone number, a GPS position) stays hidden until it is added here.
 */
const PUBLIC_KEYS = new Set([
  "acceptedKg",
  "attempt",
  "back",
  "chosenMaterial",
  "chosenWeight",
  "decision",
  "demo",
  "driverSaid",
  "from",
  "front",
  "holdReason",
  "invoiceNo",
  "invoiceSays",
  "invoiceWeightKg",
  "kg",
  "kind",
  "manual",
  "manualCheck",
  "match",
  "material",
  "message",
  "netKg",
  "note",
  "plate",
  "plateMatch",
  "plateRead",
  "plateWarningReason",
  "reason",
  "source",
  "supplier",
  "supervisor",
  "to",
  "tolerancePct",
  "transporter",
  "tripNo",
  "type",
  "unloadingPoint",
  "variancePct",
  "warnings",
  "weighing",
  "weightKg",
]);

/** Text that a person typed or that was read from paper may hold a phone number. */
const TYPED_KEYS = new Set(["reason", "note", "supplier", "transporter"]);

/** Ten or more digits in a row, with or without spaces and dashes between them. */
export const hidePhoneNumbers = (text: string) =>
  text.replace(/\+?\d(?:[\s().-]{0,2}\d){9,}/g, "[number hidden]");

export function publicData(data: Record<string, unknown>): Record<string, unknown> {
  const { anpr, ...rest } = data;
  const shown: Record<string, unknown> = {
    // What the cameras read is saved inside "anpr" when a ticket starts.
    ...(anpr && typeof anpr === "object" ? (anpr as Record<string, unknown>) : {}),
    ...rest,
  };
  return Object.fromEntries(
    Object.entries(shown)
      .filter(([key]) => PUBLIC_KEYS.has(key))
      .map(([key, value]) => [
        key,
        TYPED_KEYS.has(key) && typeof value === "string" ? hidePhoneNumbers(value) : value,
      ]),
  );
}

export async function publicTicket(
  app: FastifyInstance,
  ticketNo: string,
): Promise<PublicTicketView> {
  const [row] = await app.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.ticketNo, ticketNo));
  if (!row) throw ticketNotFound();
  const ticket = await ticketView(app.db, app.storage, row.id);
  const text = (value: string | null) => (value === null ? null : hidePhoneNumbers(value));

  // Each field is named, so nothing private is passed on by accident.
  return {
    ticketNo: ticket.ticketNo,
    plate: ticket.plate,
    status: ticket.status,
    type: ticket.type,
    material: ticket.material,
    supplier: text(ticket.supplier),
    transporter: text(ticket.transporter),
    invoiceNo: ticket.invoice.number,
    invoiceWeightKg: ticket.invoice.weightKg,
    firstWeightKg: ticket.firstWeightKg,
    secondWeightKg: ticket.secondWeightKg,
    netKg: ticket.netKg,
    variancePct: ticket.variancePct,
    finalWeightKg: ticket.finalWeightKg,
    tripNo: ticket.tripNo,
    unloadingPoint: ticket.unloadingPoint,
    isDemo: ticket.isDemo,
    createdAt: ticket.createdAt,
    firstWeightAt: ticket.firstWeightAt,
    secondWeightAt: ticket.secondWeightAt,
    closedAt: ticket.closedAt,
    timeline: ticket.timeline.map((entry) => ({
      type: entry.type,
      at: entry.at,
      actorName: entry.actorName,
      data: publicData(entry.data),
    })),
    // Not the invoice: a real one carries phone numbers and prices.
    photos: ticket.photos
      .filter((photo) => photo.kind !== "INVOICE")
      .map(({ kind, url, takenAt }) => ({ kind, url, takenAt })),
  };
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight in India that began the day of `now`. */
export function startOfDayIST(now: Date): Date {
  const local = now.getTime() + IST_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - IST_OFFSET_MS);
}

/** Counts only: no names, phones or plates. */
export async function liveSummary(app: FastifyInstance): Promise<LiveSummaryResponse> {
  const today = startOfDayIST(new Date());
  const [trucks] = await app.db
    .select({ n: count() })
    .from(tickets)
    .where(gte(tickets.createdAt, today));
  const [stopped] = await app.db
    .select({ n: count() })
    .from(tickets)
    .where(and(inArray(tickets.status, ["BLOCKED", "REJECTED"]), gte(tickets.closedAt, today)));

  const completed = await app.db
    .select({ ticket: tickets, material: materials.name })
    .from(tickets)
    .innerJoin(materials, eq(tickets.materialId, materials.id))
    .where(and(eq(tickets.status, "COMPLETED"), gte(tickets.closedAt, today)));
  const decided =
    completed.length === 0
      ? []
      : await app.db
          .select()
          .from(approvals)
          .where(
            inArray(
              approvals.ticketId,
              completed.map((row) => row.ticket.id),
            ),
          );
  const received = new Map<string, number>();
  for (const { ticket, material } of completed) {
    const kg = finalWeightOf(
      ticket,
      decided.filter((row) => row.ticketId === ticket.id),
    );
    received.set(material, (received.get(material) ?? 0) + (kg ?? 0));
  }

  const { state } = app.hardware;
  return {
    trucksToday: trucks!.n,
    kgByMaterial: [...received]
      .map(([material, kg]) => ({ material, kg }))
      .sort((a, b) => a.material.localeCompare(b.material)),
    pendingApprovals: (await pendingApprovals(app)).length,
    blockedOrRejected: stopped!.n,
    devicesOnline: {
      main: state.isOnline("main"),
      front: state.isOnline("front"),
      back: state.isOnline("back"),
    },
  };
}
