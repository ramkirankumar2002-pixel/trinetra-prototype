// What people without a login may see: the page behind the slip's QR code, and the live
// summary (build plan section 12). Everything shown is named here, one value at a time, so
// something new (a phone number, an id, a photo) stays hidden until it is added.
import {
  PUBLIC_TOKEN_PATTERN,
  type LiveSummaryResponse,
  type PublicStepName,
  type PublicTicketView,
  type PublicTimelineStep,
  type TimelineEntry,
} from "@trinetra/shared";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { approvals, materials, tickets, users } from "../db/schema";
import { ticketNotFound } from "./repo";
import { pendingApprovals } from "./store";
import { finalWeightOf, ticketView } from "./view";

/** Ten or more digits in a row, with or without spaces and dashes between them. */
export const hidePhoneNumbers = (text: string) =>
  text.replace(/\+?\d(?:[\s().-]{0,2}\d){9,}/g, "[number hidden]");

const typed = (value: unknown): string | null =>
  typeof value === "string" ? hidePhoneNumbers(value) : null;
const weight = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** The supervisors and the store officer, by how the timeline names them ("user:5"). */
export type Staff = ReadonlyMap<string, NonNullable<PublicTimelineStep["by"]>>;

/** The steps one timeline row stands for. Most rows stand for none. */
function stepsOf({ data, at, type, actor }: TimelineEntry, staff: Staff): PublicTimelineStep[] {
  const step = (
    name: PublicStepName,
    more: Partial<PublicTimelineStep> = {},
  ): PublicTimelineStep => ({
    step: name,
    at,
    by: staff.get(actor) ?? null,
    kg: null,
    reason: null,
    manual: false,
    ...more,
  });
  const turnedAway = (name: PublicStepName) => [step(name, { reason: typed(data.reason) })];
  const plateRead = () => step("PLATE_READ", { manual: data.manual === true });
  const completed = () => step("COMPLETED", { by: null });
  const kg = weight(data.kg);

  switch (type) {
    case "TICKET_CREATED":
      return [step("ARRIVED"), plateRead()];
    // The truck is back for its second weighing.
    case "PLATE_READ":
      return [plateRead()];
    case "INVOICE_READ":
      return [step("BILL_READ")];
    case "FIRST_WEIGHT_SAVED":
    case "FIRST_WEIGHT_HELD":
      return [step("FIRST_WEIGHT", { kg })];
    case "PLATE_WARNING_APPROVED":
      return [step("PLATE_ALLOWED")];
    case "MISMATCH_RESOLVED":
      return [step("MATERIAL_SET")];
    case "SUPERVISOR_APPROVED":
      return [step("SUPERVISOR_APPROVED", { manual: data.manualCheck === true })];
    case "SUPERVISOR_REJECTED":
      return turnedAway("SUPERVISOR_REJECTED");
    case "STORE_APPROVED":
      return [step("STORE_APPROVED")];
    case "SECOND_WEIGHT_PASSED":
      return [step("SECOND_WEIGHT", { kg }), completed()];
    case "SECOND_WEIGHT_FAILED":
      return [step("SECOND_WEIGHT", { kg }), step("ON_HOLD")];
    case "HOLD_APPROVED":
      return [step("HOLD_APPROVED", { kg: weight(data.acceptedKg) }), completed()];
    case "STORE_REJECTED":
    case "HOLD_REJECTED":
    case "MISMATCH_REJECTED":
    case "PLATE_WARNING_REJECTED":
      return turnedAway("STORE_REJECTED");
    case "STORE_CANCELLED":
      return turnedAway("CANCELLED");
    case "ABANDON":
      return [step("ABANDONED")];
    default:
      return [];
  }
}

export function publicTimeline(entries: TimelineEntry[], staff: Staff): PublicTimelineStep[] {
  // A bill sent twice is one step: the reading that counts is the newest.
  const bill = entries.filter((entry) => entry.type === "INVOICE_READ").at(-1);
  return entries
    .filter((entry) => entry.type !== "INVOICE_READ" || entry === bill)
    .flatMap((entry) => stepsOf(entry, staff));
}

async function staffByActor(app: FastifyInstance): Promise<Staff> {
  const rows = await app.db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(inArray(users.role, ["SUPERVISOR", "STORE"]));
  return new Map(
    rows.map((row) => [
      `user:${row.id}`,
      { name: row.name, role: row.role === "STORE" ? "STORE" : "SUPERVISOR" },
    ]),
  );
}

export async function publicTicket(app: FastifyInstance, token: string): Promise<PublicTicketView> {
  // The ticket is found by its token alone: a ticket number or an id finds nothing.
  if (!PUBLIC_TOKEN_PATTERN.test(token)) throw ticketNotFound();
  const [row] = await app.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.publicToken, token));
  if (!row) throw ticketNotFound();
  const ticket = await ticketView(app.db, app.storage, row.id);
  // Only the front camera's picture of the truck: never the bill or a photo staff took.
  const front = ticket.photos.filter((photo) => photo.kind === "FRONT_PLATE").at(-1);

  return {
    ticketNo: ticket.ticketNo,
    plate: ticket.plate,
    status: ticket.status,
    type: ticket.type,
    material: ticket.material,
    invoiceNo: typed(ticket.invoice.number),
    invoiceWeightKg: ticket.invoice.weightKg,
    firstWeightKg: ticket.firstWeightKg,
    secondWeightKg: ticket.secondWeightKg,
    netKg: ticket.netKg,
    variancePct: ticket.variancePct,
    finalWeightKg: ticket.finalWeightKg,
    unloadingPoint: ticket.unloadingPoint
      ? { code: ticket.unloadingPoint.code, name: ticket.unloadingPoint.name }
      : null,
    isDemo: ticket.isDemo,
    createdAt: ticket.createdAt,
    frontPhoto: front ? { url: front.url, takenAt: front.takenAt } : null,
    timeline: publicTimeline(ticket.timeline, await staffByActor(app)),
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
