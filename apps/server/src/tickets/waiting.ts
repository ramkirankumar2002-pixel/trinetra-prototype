// Visits that wait for a person (the rule is waitsForPerson() in shared): they are never
// abandoned by the clock, and the store officer may cancel them.
import { waitsForPerson } from "@trinetra/shared";
import { and, eq } from "drizzle-orm";
import { approvals } from "../db/schema";
import type { ApprovalRow, Reader, TicketRow } from "./repo";

export const pendingRequestsOf = (db: Reader, ticketId: number): Promise<ApprovalRow[]> =>
  db
    .select()
    .from(approvals)
    .where(and(eq(approvals.ticketId, ticketId), eq(approvals.status, "PENDING")))
    .orderBy(approvals.id);

/** Lock the ticket first: a request is only ever made with the ticket locked. */
export const isWaitingForPerson = async (db: Reader, ticket: TicketRow): Promise<boolean> =>
  waitsForPerson(ticket.status, await pendingRequestsOf(db, ticket.id));
