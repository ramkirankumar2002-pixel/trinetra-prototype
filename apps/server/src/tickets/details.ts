// PATCH /api/tickets/:id/details: what the driver says (also "loaded or empty" and "no
// invoice"), and the material mismatch check (build plan section 6, rule 5).
import { matchMaterial, type DetailsResponse, type ticketDetailsSchema } from "@trinetra/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { approvals, materials, ticketEvents, uploadLinks } from "../db/schema";
import { AppError } from "../errors/app-error";
import { SIGNALS } from "../hardware/signals";
import {
  addEvent,
  changeStatus,
  lockTicket,
  readNumberSetting,
  updateTicket,
  wrongStage,
  type Actor,
  type TicketRow,
} from "./repo";
import type { Transaction } from "../realtime/after-commit";
import { ticketView } from "./view";

export const DEFAULT_MISMATCH_ATTEMPTS = 5;

type Details = z.output<typeof ticketDetailsSchema>;

/** Anything that only a loaded truck has. After that it cannot be called empty. */
async function hasLoadedAnswers(tx: Transaction, ticket: TicketRow): Promise<boolean> {
  if (ticket.materialId !== null || ticket.noInvoice || ticket.mismatchAttempts > 0) return true;
  if (ticket.invoiceNo !== null || ticket.invoiceWeightKg !== null) return true;
  const [upload] = await tx
    .select({ id: ticketEvents.id })
    .from(ticketEvents)
    .where(and(eq(ticketEvents.ticketId, ticket.id), eq(ticketEvents.type, "INVOICE_RECEIVED")))
    .limit(1);
  return upload !== undefined;
}

/**
 * "No invoice": whatever was read before is dropped, and the QR codes shown so far stop
 * working. A file sent after this, on a new code, counts again.
 */
async function dropInvoice(tx: Transaction, ticket: TicketRow, actor: Actor): Promise<TicketRow> {
  const now = new Date();
  await tx
    .update(uploadLinks)
    .set({ expiresAt: now })
    .where(
      and(
        eq(uploadLinks.ticketId, ticket.id),
        isNull(uploadLinks.usedAt),
        gt(uploadLinks.expiresAt, now),
      ),
    );
  if (!ticket.noInvoice) await addEvent(tx, ticket.id, "NO_INVOICE", actor);
  return updateTicket(tx, ticket, {
    noInvoice: true,
    invoiceNo: null,
    invoiceMaterial: null,
    invoiceDate: null,
    invoiceWeightKg: null,
  });
}

export async function saveDetails(
  app: FastifyInstance,
  ticketId: number,
  details: Details,
  actor: Actor,
): Promise<DetailsResponse> {
  const { material: said, noInvoice, ...others } = details;

  const result = await app.eventTransaction(async (tx) => {
    let ticket = await lockTicket(tx, ticketId);
    if (ticket.status !== "STARTED") {
      throw wrongStage("The answers can only be changed before the first weight.");
    }
    const limit = await readNumberSetting(tx, "mismatch_attempts", DEFAULT_MISMATCH_ATTEMPTS);
    let materialMatched = true;
    let materialId: number | undefined;

    if ((others.load ?? ticket.load) === "EMPTY") {
      if (said !== undefined || noInvoice) {
        throw new AppError(409, "EMPTY_TRUCK", "An empty truck has no material or invoice.");
      }
      if (ticket.load !== "EMPTY" && (await hasLoadedAnswers(tx, ticket))) {
        throw new AppError(
          409,
          "ALREADY_LOADED",
          "This truck has already given answers for a load. Ask the store officer.",
        );
      }
    }
    // Before the material, so it is not compared with an invoice that is being dropped.
    if (noInvoice) ticket = await dropInvoice(tx, ticket, actor);

    if (said !== undefined) {
      const list = await tx.select().from(materials);
      const chosen = list.find((item) => item.name.toLowerCase() === said.toLowerCase());
      if (!chosen) {
        throw new AppError(400, "UNKNOWN_MATERIAL", "That material is not in the list.");
      }
      const [storeChoice] = await tx
        .select({ materialId: approvals.chosenMaterialId })
        .from(approvals)
        .where(
          and(
            eq(approvals.ticketId, ticketId),
            eq(approvals.kind, "MISMATCH"),
            eq(approvals.status, "APPROVED"),
          ),
        );

      if (storeChoice) {
        if (storeChoice.materialId !== chosen.id) {
          throw new AppError(
            409,
            "MATERIAL_SET_BY_STORE",
            "The store officer has set the material for this truck.",
          );
        }
      } else if (ticket.invoiceMaterial) {
        // No match for the invoice text means there is nothing to compare with.
        const onInvoice = matchMaterial(ticket.invoiceMaterial, list)?.material;
        materialMatched = !onInvoice || onInvoice.id === chosen.id;
      }
      if (materialMatched) materialId = chosen.id;
    }

    const attempts = ticket.mismatchAttempts + (materialMatched ? 0 : 1);
    ticket = await updateTicket(tx, ticket, {
      ...others,
      ...(materialId === undefined ? {} : { materialId }),
      // A wrong answer leaves no material behind, so the truck cannot be weighed with one.
      ...(materialMatched ? {} : { materialId: null, mismatchAttempts: attempts }),
    });

    // The timeline is public through the QR code, so it never holds the driver's details.
    const { driverName, driverPhone, ...shown } = others;
    const saved = {
      ...shown,
      ...(materialId === undefined ? {} : { material: said }),
      ...(driverName === undefined ? {} : { driverNameSaved: true }),
      ...(driverPhone === undefined ? {} : { driverPhoneSaved: true }),
    };
    // A switch of language alone is not an answer: it is saved on the ticket, and adds
    // no line to the timeline.
    if (Object.keys(saved).some((key) => key !== "language")) {
      await addEvent(tx, ticketId, "DETAILS_SAVED", actor, saved);
    }
    if (!materialMatched) {
      await addEvent(tx, ticketId, "MATERIAL_MISMATCH", actor, {
        driverSaid: said,
        invoiceSays: ticket.invoiceMaterial,
        attempt: attempts,
      });
      if (attempts >= limit) {
        await changeStatus(tx, ticket, "MISMATCH_LIMIT_REACHED", {
          actor,
          data: { driverSaid: said, invoiceSays: ticket.invoiceMaterial },
          request: "MISMATCH",
        });
      }
    }
    return { materialMatched, attemptsLeft: Math.max(0, limit - attempts) };
  });

  const saved = await ticketView(app.db, app.storage, ticketId);
  if (saved.status === "MISMATCH_PENDING") app.hardware.signals.show(SIGNALS.officeFirst);
  return { ...result, ticket: saved };
}
