// A weighbridge fault (tampered load cell wiring) goes on the timeline of the truck that is
// on the bridge when it starts, and so does its end. The screens hear of it through
// realtime/forward-hardware.ts, with or without a truck.
import type { TamperReason } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { emitAfterCommit } from "../realtime/after-commit";
import { addEvent, lockTicket, ticketRooms } from "./repo";

export interface BridgeTicket {
  id: number | null;
}

async function note(
  app: FastifyInstance,
  ticketId: number,
  type: "WEIGHBRIDGE_FAULT" | "WEIGHBRIDGE_FAULT_CLEARED",
  reason: TamperReason,
): Promise<void> {
  await app.eventTransaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId);
    await addEvent(tx, ticketId, type, "device:main", { reason });
    emitAfterCommit("ticket:updated", ticketRooms(ticket), { ticketId, status: ticket.status });
  });
}

export function recordFaults(app: FastifyInstance): void {
  /** The ticket whose timeline has the fault that is going on. */
  let noted: number | null = null;
  // One after another, so "cleared" can never be written before the fault itself.
  let last = Promise.resolve();
  const inOrder = (work: () => Promise<void>) => {
    last = last.then(work).catch((error: unknown) => {
      app.log.error({ err: error }, "could not write a weighbridge fault on the timeline");
    });
    app.background.run("weighbridge fault", () => last);
  };

  app.hardware.bus.on("hw:fault", ({ fault, reason }) => {
    if (fault) {
      // A fault that only changes its reason stays with the same ticket.
      const ticketId = noted ?? app.bridgeTicket.id;
      noted = ticketId;
      if (ticketId !== null) {
        inOrder(() => note(app, ticketId, "WEIGHBRIDGE_FAULT", reason));
      }
      return;
    }
    const ticketId = noted;
    noted = null;
    if (ticketId !== null) {
      inOrder(() => note(app, ticketId, "WEIGHBRIDGE_FAULT_CLEARED", reason));
    }
  });
}
