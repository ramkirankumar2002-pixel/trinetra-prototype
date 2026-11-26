// PATCH /api/tickets/:id/details: what the driver says, and the material mismatch check
// (build plan section 6, rule 5).
import { matchMaterial, type DetailsResponse, type ticketDetailsSchema } from "@trinetra/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { approvals, materials } from "../db/schema";
import { AppError } from "../errors/app-error";
import {
  addEvent,
  changeStatus,
  createApproval,
  lockTicket,
  readNumberSetting,
  updateTicket,
  wrongStage,
  type Actor,
} from "./repo";
import { ticketView } from "./view";

export const DEFAULT_MISMATCH_ATTEMPTS = 5;

type Details = z.output<typeof ticketDetailsSchema>;

export async function saveDetails(
  app: FastifyInstance,
  ticketId: number,
  details: Details,
  actor: Actor,
): Promise<DetailsResponse> {
  const { material: said, ...others } = details;

  const result = await app.eventTransaction(async (tx) => {
    let ticket = await lockTicket(tx, ticketId);
    if (ticket.status !== "STARTED") {
      throw wrongStage("The answers can only be changed before the first weight.");
    }
    const limit = await readNumberSetting(tx, "mismatch_attempts", DEFAULT_MISMATCH_ATTEMPTS);
    let materialMatched = true;
    let materialId: number | undefined;

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
    if (Object.keys(saved).length > 0) {
      await addEvent(tx, ticketId, "DETAILS_SAVED", actor, saved);
    }
    if (!materialMatched) {
      await addEvent(tx, ticketId, "MATERIAL_MISMATCH", actor, {
        driverSaid: said,
        invoiceSays: ticket.invoiceMaterial,
        attempt: attempts,
      });
      if (attempts >= limit) {
        ticket = await changeStatus(tx, ticket, "MISMATCH_LIMIT_REACHED", { actor });
        await createApproval(tx, ticket, { kind: "MISMATCH" }, actor, {
          driverSaid: said,
          invoiceSays: ticket.invoiceMaterial,
        });
      }
    }
    return { materialMatched, attemptsLeft: Math.max(0, limit - attempts) };
  });

  return { ...result, ticket: await ticketView(app.db, app.storage, ticketId) };
}
