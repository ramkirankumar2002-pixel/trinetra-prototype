// The store officer ends a visit that is waiting for a person: a truck that has gone, or
// a visit that cannot go on. It is not a rejection (those have their own buttons): the
// ticket ends as ABANDONED, and the timeline says who cancelled it and why.
import { waitsForPerson } from "@trinetra/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { approvals } from "../db/schema";
import { markHandled } from "./decisions";
import { changeStatus, lockTicket, userActor, wrongStage } from "./repo";
import { ticketView } from "./view";
import { pendingRequestsOf } from "./waiting";

export async function cancelVisit(
  app: FastifyInstance,
  ticketId: number,
  officerId: number,
  reason: string,
) {
  const actor = userActor(officerId);
  await app.eventTransaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId);
    const pending = await pendingRequestsOf(tx, ticketId);
    if (!waitsForPerson(ticket.status, pending)) {
      throw wrongStage("This visit is not waiting for a person, so it cannot be cancelled.");
    }

    // Help calls and plate warnings would otherwise stay in the queue for ever: they are
    // closed in the officer's name. A request for a decision is left unanswered; a closed
    // ticket takes it out of every list.
    for (const request of pending) {
      if (request.kind !== "DRIVER_HELP" && request.plateWarningReason !== "FRONT_BACK_MISMATCH") {
        continue;
      }
      const note = `Visit cancelled: ${reason}`.slice(0, 300);
      await tx
        .update(approvals)
        .set({ status: "APPROVED", decidedBy: officerId, decidedAt: new Date(), reason: note })
        .where(eq(approvals.id, request.id));
      await markHandled(tx, ticket, actor, {
        approvalId: request.id,
        kind: request.kind,
        decision: "APPROVE",
        reason: note,
      });
    }

    await changeStatus(tx, ticket, "STORE_CANCELLED", { actor, data: { reason } });
  });
  return ticketView(app.db, app.storage, ticketId);
}
