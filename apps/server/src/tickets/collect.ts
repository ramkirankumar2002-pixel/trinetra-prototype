// The kiosk's Ready screen (build plan section 8, screen 1): trucks whose slip is waiting
// (approved by the store officer, or finished and not printed), and trucks just turned
// away.
import type { KioskCollectResponse } from "@trinetra/shared";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { approvals, ticketEvents, tickets } from "../db/schema";

/** How long "Not approved — please leave" stays on the screen. */
export const NOT_APPROVED_SHOWN_MS = 10 * 60 * 1000;
/** A slip nobody collected leaves the list after one working day. */
export const COLLECT_FOR_MS = 12 * 60 * 60 * 1000;

/** A Type 2 truck still on its way: after the second weight the first slip is not needed. */
const AWAITING_SECOND = new Set(["READY_FOR_UNLOAD", "SUPERVISOR_PENDING", "READY_FOR_SECOND"]);

export async function kioskCollect(
  app: FastifyInstance,
  now = new Date(),
): Promise<KioskCollectResponse> {
  const decided = await app.db
    .select({ approval: approvals, ticket: tickets })
    .from(approvals)
    .innerJoin(tickets, eq(approvals.ticketId, tickets.id))
    .where(
      and(
        inArray(approvals.kind, ["STORE_TYPE2", "HOLD"]),
        eq(approvals.status, "APPROVED"),
        gte(approvals.decidedAt, new Date(now.getTime() - COLLECT_FOR_MS)),
      ),
    )
    .orderBy(desc(approvals.decidedAt), desc(approvals.id));

  const finished = await app.db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.status, "COMPLETED"),
        gte(tickets.closedAt, new Date(now.getTime() - COLLECT_FOR_MS)),
      ),
    )
    .orderBy(desc(tickets.closedAt), desc(tickets.id));

  // Both lists as one, newest first, by when the slip became ready.
  const waitingSlips = [
    ...decided.map(({ approval, ticket }) => ({
      ticket,
      slip: approval.kind === "HOLD" ? ("FINAL" as const) : ("FIRST" as const),
      since: approval.decidedAt!,
    })),
    ...finished.map((ticket) => ({ ticket, slip: "FINAL" as const, since: ticket.closedAt! })),
  ].sort((a, b) => b.since.getTime() - a.since.getTime() || b.ticket.id - a.ticket.id);

  const printed = new Set<string>();
  if (waitingSlips.length > 0) {
    const rows = await app.db
      .select({ ticketId: ticketEvents.ticketId, data: ticketEvents.data })
      .from(ticketEvents)
      .where(
        and(
          eq(ticketEvents.type, "SLIP_PRINTED"),
          inArray(
            ticketEvents.ticketId,
            waitingSlips.map((row) => row.ticket.id),
          ),
        ),
      );
    for (const row of rows) printed.add(`${row.ticketId}:${String(row.data.kind)}`);
  }

  const ready: KioskCollectResponse["ready"] = [];
  const listed = new Set<number>();
  for (const { ticket, slip } of waitingSlips) {
    const waiting =
      slip === "FINAL" ? ticket.status === "COMPLETED" : AWAITING_SECOND.has(ticket.status);
    if (!waiting || listed.has(ticket.id) || printed.has(`${ticket.id}:${slip}`)) continue;
    listed.add(ticket.id);
    ready.push({ ticketId: ticket.id, ticketNo: ticket.ticketNo, plate: ticket.plate, slip });
  }

  const rejected = await app.db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.status, "REJECTED"),
        gte(tickets.closedAt, new Date(now.getTime() - NOT_APPROVED_SHOWN_MS)),
      ),
    )
    .orderBy(desc(tickets.closedAt));

  return {
    ready,
    notApproved: rejected.map((ticket) => ({
      ticketId: ticket.id,
      plate: ticket.plate,
      until: new Date(ticket.closedAt!.getTime() + NOT_APPROVED_SHOWN_MS).toISOString(),
    })),
  };
}
