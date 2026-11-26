// "Weigh again" and the Print button (build plan section 8, screens 11 and 12).
import type { SlipKind } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { addEvent, lockTicket, updateTicket, wrongStage, type Actor, type TicketRow } from "./repo";
import { ticketView } from "./view";

/**
 * The driver does not accept the weight on screen, before confirming it. Nothing saved is
 * ever removed: once a weight is confirmed it stays, so a truck cannot be weighed again
 * and again until it passes. The 3 second stability window starts afresh.
 */
export async function discardWeight(app: FastifyInstance, ticketId: number, actor: Actor) {
  await app.eventTransaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId);
    if (ticket.status !== "STARTED" && ticket.status !== "READY_FOR_SECOND") {
      throw wrongStage("This weight is already saved and cannot be weighed again.");
    }
    await addEvent(tx, ticketId, "WEIGHT_DISCARDED", actor, {
      weighing: ticket.status === "STARTED" ? "FIRST" : "SECOND",
      // What the weighbridge showed, for the record only.
      kg: app.hardware.state.currentReading()?.kg ?? null,
    });
    await updateTicket(tx, ticket, {});
  });
  app.hardware.state.restartStability();
  return ticketView(app.db, app.storage, ticketId);
}

function checkMayPrint(ticket: TicketRow, kind: SlipKind): void {
  if (kind === "FINAL") {
    // A blocked or held truck gets no final slip.
    if (ticket.status !== "COMPLETED") throw wrongStage("There is no final slip for this truck.");
    return;
  }
  if (ticket.firstWeightKg === null) throw wrongStage("There is no slip for this truck yet.");
}

/** Records that the Print button was pressed. */
export async function logPrinted(
  app: FastifyInstance,
  ticketId: number,
  kind: SlipKind,
  actor: Actor,
) {
  await app.eventTransaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId);
    checkMayPrint(ticket, kind);
    await addEvent(tx, ticketId, "SLIP_PRINTED", actor, { kind });
  });
  return { ok: true as const };
}
