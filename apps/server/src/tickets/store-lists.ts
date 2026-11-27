// The store officer's own views: the numbers on their home page, the trucks on site now,
// and the tickets that ended today.
import {
  CLOSED_TICKET_STATUSES,
  normalizePlate,
  type StoreSummaryResponse,
  type StoreTicketDecision,
  type StoreTicketsResponse,
  type StoreTicketView,
} from "@trinetra/shared";
import { and, asc, count, desc, eq, gte, ilike, inArray, ne, notInArray, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { approvals, materials, tickets, unloadingPoints, users } from "../db/schema";
import { startOfDayIST } from "./public";
import { pendingApprovals } from "./store";
import { finalWeightOf, userNames } from "./view";

/** Far more trucks than one weighbridge sees in a day. */
const LIST_LIMIT = 500;

/** Warnings and help calls: marking one as handled approves nothing. */
const isNotice = (row: { kind: string; plateWarningReason: string | null }) =>
  row.kind === "DRIVER_HELP" || row.plateWarningReason === "FRONT_BACK_MISMATCH";

export async function storeSummary(app: FastifyInstance): Promise<StoreSummaryResponse> {
  const today = startOfDayIST(new Date());
  const waiting = (await pendingApprovals(app)).filter((row) => row.approval.kind !== "SUPERVISOR");
  const decided = (
    await app.db
      .select({ approval: approvals })
      .from(approvals)
      .innerJoin(users, eq(approvals.decidedBy, users.id))
      .where(and(eq(users.role, "STORE"), gte(approvals.decidedAt, today)))
  ).filter(({ approval }) => !isNotice(approval));

  const countWhere = async (condition: ReturnType<typeof and>) => {
    const [row] = await app.db.select({ n: count() }).from(tickets).where(condition);
    return row!.n;
  };

  return {
    waiting: waiting.length,
    approved: decided.filter(({ approval }) => approval.status === "APPROVED").length,
    rejected: decided.filter(({ approval }) => approval.status === "REJECTED").length,
    onHold: await countWhere(eq(tickets.status, "HOLD_PENDING")),
    onSite: await countWhere(notInArray(tickets.status, [...CLOSED_TICKET_STATUSES])),
    completed: await countWhere(and(eq(tickets.status, "COMPLETED"), gte(tickets.closedAt, today))),
  };
}

const ticketRows = (app: FastifyInstance) =>
  app.db
    .select({
      ticket: tickets,
      material: materials.name,
      point: unloadingPoints,
      supervisor: users.name,
    })
    .from(tickets)
    .leftJoin(materials, eq(tickets.materialId, materials.id))
    .leftJoin(unloadingPoints, eq(tickets.unloadingPointId, unloadingPoints.id))
    .leftJoin(users, eq(tickets.supervisorId, users.id));

async function ticketViews(
  app: FastifyInstance,
  rows: Awaited<ReturnType<typeof ticketRows>>,
): Promise<StoreTicketView[]> {
  const requests =
    rows.length === 0
      ? []
      : await app.db
          .select()
          .from(approvals)
          .where(
            inArray(
              approvals.ticketId,
              rows.map((row) => row.ticket.id),
            ),
          )
          .orderBy(asc(approvals.id));
  const names = await userNames(
    app.db,
    requests.map((row) => row.decidedBy).filter((id): id is number => id !== null),
  );
  const waiting = new Map<number, number>();
  for (const { approval } of await pendingApprovals(app)) {
    if (approval.kind === "SUPERVISOR" || approval.ticketId === null) continue;
    // Newest first, so the oldest is written last and stays.
    waiting.set(approval.ticketId, approval.id);
  }

  return rows.map(({ ticket, material, point, supervisor }) => {
    const mine = requests.filter((row) => row.ticketId === ticket.id);
    return {
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      plate: ticket.plate,
      status: ticket.status,
      type: ticket.type,
      material,
      tripNo: ticket.tripNo,
      unloadingPoint: point ? { code: point.code, name: point.name } : null,
      supervisor,
      invoiceWeightKg: ticket.invoiceWeightKg,
      netKg: ticket.netKg,
      variancePct: ticket.variancePct,
      finalWeightKg: finalWeightOf(ticket, mine),
      pendingStoreApprovalId: waiting.get(ticket.id) ?? null,
      decisions: mine.flatMap((row): StoreTicketDecision[] =>
        row.status === "PENDING" || !row.decidedAt
          ? []
          : [
              {
                approvalId: row.id,
                kind: row.kind,
                plateWarningReason: row.plateWarningReason,
                status: row.status,
                decidedBy: row.decidedBy ? (names.get(row.decidedBy)?.name ?? null) : null,
                decidedAt: row.decidedAt.toISOString(),
                reason: row.reason,
                chosenWeight: row.chosenWeight,
              },
            ],
      ),
      isDemo: ticket.isDemo,
      createdAt: ticket.createdAt.toISOString(),
      firstWeightAt: ticket.firstWeightAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
    };
  });
}

/** Every truck whose visit has not ended, the one that came first at the top. */
export async function trucksOnSite(app: FastifyInstance): Promise<StoreTicketsResponse> {
  const rows = await ticketRows(app)
    .where(notInArray(tickets.status, [...CLOSED_TICKET_STATUSES]))
    .orderBy(asc(tickets.createdAt), asc(tickets.id))
    .limit(LIST_LIMIT);
  return { tickets: await ticketViews(app, rows) };
}

/** "%", "_" and "\" mean something to LIKE: here they are only letters. */
const likeText = (text: string) => text.replace(/[\\%_]/g, "\\$&");

/**
 * Today's completed, rejected and blocked tickets, the newest first. A visit the driver
 * walked away from before the first weight is not listed.
 */
export async function storeHistory(
  app: FastifyInstance,
  search: string,
): Promise<StoreTicketsResponse> {
  const plate = normalizePlate(search);
  const found = search
    ? or(
        ilike(tickets.ticketNo, `%${likeText(search)}%`),
        // A search of only spaces and dashes has no plate left, and must not match all.
        plate ? ilike(tickets.plate, `%${likeText(plate)}%`) : undefined,
      )
    : undefined;
  const rows = await ticketRows(app)
    .where(
      and(
        inArray(tickets.status, [...CLOSED_TICKET_STATUSES]),
        ne(tickets.status, "ABANDONED"),
        gte(tickets.closedAt, startOfDayIST(new Date())),
        found,
      ),
    )
    .orderBy(desc(tickets.closedAt), desc(tickets.id))
    .limit(LIST_LIMIT);
  return { tickets: await ticketViews(app, rows) };
}
