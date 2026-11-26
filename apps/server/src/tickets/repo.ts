// The small database moves every ticket flow is built from. All writes happen inside
// app.eventTransaction(), so live events leave only after the commit.
import {
  isClosedStatus,
  supervisorRoom,
  ticketNumber,
  transition,
  type ApprovalKind,
  type PlateCheck,
  type PlateWarningReason,
  type Room,
  type TicketEvent,
  type TransitionContext,
} from "@trinetra/shared";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { CLOSED_TICKET_STATUSES } from "@trinetra/shared";
import type { Database } from "../db/client";
import { approvals, settings, ticketEvents, tickets } from "../db/schema";
import { AppError } from "../errors/app-error";
import { emitAfterCommit, type Transaction } from "../realtime/after-commit";

/** A connection or a transaction: both can read. */
export type Reader = Database | Transaction;

export type TicketRow = typeof tickets.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
type TicketChanges = Partial<typeof tickets.$inferInsert>;

/** Who did something, as ticket_events stores it. */
export type Actor = "system" | `user:${number}` | `device:${string}`;
export const userActor = (userId: number): Actor => `user:${userId}`;

export const ticketNotFound = () => new AppError(404, "NOT_FOUND", "There is no such ticket.");

export const wrongStage = (message: string) => new AppError(409, "WRONG_STAGE", message);

export async function getTicket(db: Reader, id: number): Promise<TicketRow> {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, id));
  if (!row) throw ticketNotFound();
  return row;
}

/** Reads a ticket and holds it until the transaction ends, so changes happen one at a time. */
export async function lockTicket(tx: Transaction, id: number): Promise<TicketRow> {
  const [row] = await tx.select().from(tickets).where(eq(tickets.id, id)).for("update");
  if (!row) throw ticketNotFound();
  return row;
}

export async function findOpenTicket(db: Reader, plate: string): Promise<TicketRow | undefined> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.plate, plate), notInArray(tickets.status, [...CLOSED_TICKET_STATUSES])));
  return row;
}

export async function addEvent(
  tx: Transaction,
  ticketId: number,
  type: string,
  actor: Actor,
  data: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(ticketEvents).values({ ticketId, type, actor, data });
}

/** Updates a ticket without changing its status. Also counts as activity. */
export async function updateTicket(
  tx: Transaction,
  ticket: TicketRow,
  changes: Omit<TicketChanges, "status">,
): Promise<TicketRow> {
  const [row] = await tx
    .update(tickets)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(tickets.id, ticket.id))
    .returning();
  return row!;
}

/** Who is told about a ticket. A supervisor hears only about their own Type 1 trucks. */
export function ticketRooms(ticket: Pick<TicketRow, "type" | "supervisorId">): Room[] {
  const rooms: Room[] = ["kiosk", "store", "live"];
  if (ticket.type === "TYPE_1" && ticket.supervisorId !== null) {
    rooms.push(supervisorRoom(ticket.supervisorId));
  }
  return rooms;
}

/**
 * THE ONLY WAY A STATUS CHANGES. transition() decides whether the move is allowed; the
 * new status, its timeline row and its live event are saved or dropped together.
 * The ticket must have been read with lockTicket() in this transaction.
 */
export async function changeStatus(
  tx: Transaction,
  ticket: TicketRow,
  event: TicketEvent,
  options: {
    actor: Actor;
    data?: Record<string, unknown>;
    /** Other columns saved with the move. */
    set?: Omit<TicketChanges, "status">;
    context?: TransitionContext;
  },
): Promise<TicketRow> {
  const { actor, data = {}, set = {}, context } = options;
  const status = transition(ticket.status, event, context);
  const now = new Date();
  const [row] = await tx
    .update(tickets)
    .set({ ...set, status, updatedAt: now, ...(isClosedStatus(status) ? { closedAt: now } : {}) })
    .where(eq(tickets.id, ticket.id))
    .returning();
  await addEvent(tx, ticket.id, event, actor, { from: ticket.status, to: status, ...data });
  emitAfterCommit("ticket:updated", ticketRooms(row!), { ticketId: ticket.id, status });
  return row!;
}

/** Opens a request for a person to decide, and rings the right phone. */
export async function createApproval(
  tx: Transaction,
  ticket: TicketRow | null,
  request: { kind: ApprovalKind; plateWarningReason?: PlateWarningReason },
  actor: Actor,
  data: Record<string, unknown> = {},
): Promise<ApprovalRow> {
  const { kind, plateWarningReason } = request;
  const [approval] = await tx
    .insert(approvals)
    .values({
      ticketId: ticket?.id ?? null,
      kind,
      ...(plateWarningReason ? { plateWarningReason } : {}),
    })
    .returning();
  if (ticket) {
    await addEvent(tx, ticket.id, "APPROVAL_REQUESTED", actor, {
      approvalId: approval!.id,
      kind,
      ...(plateWarningReason ? { plateWarningReason } : {}),
      ...data,
    });
  }
  const room: Room =
    kind === "SUPERVISOR" && ticket?.supervisorId ? supervisorRoom(ticket.supervisorId) : "store";
  emitAfterCommit("approval:new", [room], {
    approvalId: approval!.id,
    ticketId: ticket?.id ?? null,
    kind,
  });
  return approval!;
}

/** Where the blocked-plate check stands. The front/back warning never counts here. */
export async function plateCheckOf(db: Reader, ticketId: number): Promise<PlateCheck> {
  const [row] = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(
      and(eq(approvals.ticketId, ticketId), eq(approvals.plateWarningReason, "BLOCKED_HISTORY")),
    )
    .orderBy(desc(approvals.id))
    .limit(1);
  return row?.status ?? "NOT_NEEDED";
}

/** One FRONT_BACK_MISMATCH warning per ticket at a time. */
export async function warnFrontBackMismatch(
  tx: Transaction,
  ticket: TicketRow,
  actor: Actor,
  reads: { front: string | null; back: string | null },
): Promise<void> {
  const [pending] = await tx
    .select({ id: approvals.id })
    .from(approvals)
    .where(
      and(
        eq(approvals.ticketId, ticket.id),
        eq(approvals.plateWarningReason, "FRONT_BACK_MISMATCH"),
        eq(approvals.status, "PENDING"),
      ),
    );
  if (pending) return;
  await createApproval(
    tx,
    ticket,
    { kind: "PLATE_WARNING", plateWarningReason: "FRONT_BACK_MISMATCH" },
    actor,
    { front: reads.front, back: reads.back },
  );
}

/**
 * "WB01-20261126-0001". The counter row is locked until the transaction ends, so two
 * trucks never get the same number, and a number is never used again, even after a reset.
 */
export async function nextTicketNumber(tx: Transaction, now: Date): Promise<string> {
  // "20261126": the date in India, taken from a ticket number.
  const day = ticketNumber(now, 1).split("-")[1]!;
  const [row] = await tx
    .insert(settings)
    .values({ key: `ticket_counter:${day}`, value: 1 })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: sql`to_jsonb((${settings.value} #>> '{}')::int + 1)` },
    })
    .returning({ value: settings.value });
  return ticketNumber(now, Number(row!.value));
}

export async function readNumberSetting(
  db: Reader,
  key: string,
  fallback: number,
): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (row === undefined) return fallback;
  const value = Number(row.value);
  if (!Number.isFinite(value)) throw new Error(`The setting ${key} is not a number.`);
  return value;
}

export async function readSettings(db: Reader, keys: string[]): Promise<Map<string, unknown>> {
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  return new Map(rows.map((row) => [row.key, row.value]));
}
