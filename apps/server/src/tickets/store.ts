// The store officer's list, and the driver's Help button (build plan sections 8 and 11).
import {
  isClosedStatus,
  type StoreRequestsResponse,
  type StoreRequestView,
} from "@trinetra/shared";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { approvals, materials, ticketEvents, tickets } from "../db/schema";
import { AppError } from "../errors/app-error";
import { createApproval, lockTicket, type Actor, type ApprovalRow, type TicketRow } from "./repo";
import { approvalView, holdReasonOf, materialNames, userNames, WARNING_EVENTS } from "./view";

const LIST_LIMIT = 100;
const WARNINGS_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * A request that can no longer change anything, because its ticket has ended (an
 * abandoned truck, for example). Warnings and help calls still want an answer.
 */
export function isStale(request: ApprovalRow, ticket: TicketRow | null): boolean {
  if (!ticket || !isClosedStatus(ticket.status)) return false;
  return request.kind !== "DRIVER_HELP" && request.plateWarningReason !== "FRONT_BACK_MISMATCH";
}

const requestRows = (app: FastifyInstance) =>
  app.db
    .select({ approval: approvals, ticket: tickets, material: materials.name })
    .from(approvals)
    .leftJoin(tickets, eq(approvals.ticketId, tickets.id))
    .leftJoin(materials, eq(tickets.materialId, materials.id));

type RequestRow = Awaited<ReturnType<typeof requestRows>>[number];

async function requestViews(app: FastifyInstance, rows: RequestRow[]) {
  const names = await userNames(
    app.db,
    rows.map((row) => row.approval.decidedBy).filter((id): id is number => id !== null),
  );
  const materialsById = await materialNames(app.db);
  const ticketIds = rows.map((row) => row.ticket?.id).filter((id): id is number => !!id);
  const held = new Set(
    ticketIds.length === 0
      ? []
      : (
          await app.db
            .select({ ticketId: approvals.ticketId })
            .from(approvals)
            .where(and(eq(approvals.kind, "HOLD"), inArray(approvals.ticketId, ticketIds)))
        ).map((row) => row.ticketId),
  );
  return rows.map(({ approval, ticket, material }): StoreRequestView => ({
    approval: approvalView(approval, names, materialsById),
    ticket: ticket && {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      plate: ticket.plate,
      status: ticket.status,
      type: ticket.type,
      material,
      supplier: ticket.supplier,
      invoiceWeightKg: ticket.invoiceWeightKg,
      heldWeightKg: ticket.heldWeightKg,
      firstWeightKg: ticket.firstWeightKg,
      secondWeightKg: ticket.secondWeightKg,
      netKg: ticket.netKg,
      variancePct: ticket.variancePct,
      holdReason: holdReasonOf(ticket, held.has(ticket.id)),
      isDemo: ticket.isDemo,
    },
  }));
}

/** Requests still waiting for a decision from anyone. */
export async function pendingApprovals(app: FastifyInstance) {
  const rows = await requestRows(app)
    .where(eq(approvals.status, "PENDING"))
    .orderBy(desc(approvals.id));
  return rows.filter((row) => !isStale(row.approval, row.ticket));
}

/**
 * Pending: what waits for the store officer. Done: what they decided, and trucks a
 * supervisor blocked, which are for their information. Newest first.
 */
export async function storeRequests(
  app: FastifyInstance,
  status: "pending" | "done",
): Promise<StoreRequestsResponse> {
  const rows =
    status === "pending"
      ? (await pendingApprovals(app))
          .filter((row) => row.approval.kind !== "SUPERVISOR")
          .slice(0, LIST_LIMIT)
      : await requestRows(app)
          .where(
            and(
              ne(approvals.status, "PENDING"),
              or(ne(approvals.kind, "SUPERVISOR"), eq(approvals.status, "REJECTED")),
            ),
          )
          .orderBy(desc(approvals.decidedAt), desc(approvals.id))
          .limit(LIST_LIMIT);

  const requests = await requestViews(app, rows);

  const warnings = await app.db
    .select({ event: ticketEvents, ticket: tickets })
    .from(ticketEvents)
    .innerJoin(tickets, eq(ticketEvents.ticketId, tickets.id))
    .where(
      and(
        inArray(ticketEvents.type, Object.keys(WARNING_EVENTS)),
        gte(ticketEvents.createdAt, new Date(Date.now() - WARNINGS_FOR_MS)),
      ),
    )
    .orderBy(desc(ticketEvents.id))
    .limit(LIST_LIMIT);

  return {
    requests,
    warnings: warnings.map(({ event, ticket }) => ({
      type: WARNING_EVENTS[event.type]!,
      message: String(event.data.message ?? ""),
      at: event.createdAt.toISOString(),
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      plate: ticket.plate,
    })),
  };
}

/** One request with its ticket's summary, pending or decided: the detail page. */
export async function storeRequest(
  app: FastifyInstance,
  approvalId: number,
): Promise<StoreRequestView> {
  const rows = await requestRows(app).where(eq(approvals.id, approvalId));
  // The supervisor's own check is not the store officer's request.
  const found = rows.filter(
    ({ approval }) => approval.kind !== "SUPERVISOR" || approval.status === "REJECTED",
  );
  if (found.length === 0) throw new AppError(404, "NOT_FOUND", "There is no such request.");
  return (await requestViews(app, found))[0]!;
}

/** The driver pressed Help. Pressing it again while the call is open adds nothing. */
export async function askForHelp(app: FastifyInstance, ticketId: number | null, actor: Actor) {
  return app.eventTransaction(async (tx) => {
    // One at a time, so two quick presses make one call.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('driver-help'))`);
    const ticket = ticketId === null ? null : await lockTicket(tx, ticketId);
    const [open] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.kind, "DRIVER_HELP"),
          eq(approvals.status, "PENDING"),
          ticketId === null ? isNull(approvals.ticketId) : eq(approvals.ticketId, ticketId),
        ),
      );
    if (open) return { approvalId: open.id, alreadyAsked: true };
    const approval = await createApproval(tx, ticket, { kind: "DRIVER_HELP" }, actor);
    return { approvalId: approval.id, alreadyAsked: false };
  });
}
