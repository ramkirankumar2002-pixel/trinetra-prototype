// The supervisor's trucks and their live photo check (build plan section 10).
import {
  MAX_SUPERVISOR_PHOTOS,
  platesMatch,
  type SupervisorPhotoResponse,
  type SupervisorTicketView,
} from "@trinetra/shared";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { approvals, materials, photos, tickets, unloadingPoints } from "../db/schema";
import { AppError } from "../errors/app-error";
import type { Upload } from "../http/upload";
import { emitAfterCommit } from "../realtime/after-commit";
import { storeFile } from "../services/images/pipeline";
import { isDemoActive, tagDemo } from "./demo";
import {
  addEvent,
  getTicket,
  lockTicket,
  ticketRooms,
  wrongStage,
  type Reader,
  type TicketRow,
  type Actor,
} from "./repo";

const LIST_LIMIT = 100;

export const notYourTicket = () =>
  new AppError(403, "NOT_YOUR_TICKET", "This truck was not sent to you.");

/** Only a Type 1 truck sent to this supervisor is theirs. */
export function assertOwnTicket(ticket: TicketRow, userId: number): void {
  if (ticket.type !== "TYPE_1" || ticket.supervisorId !== userId) throw notYourTicket();
}

async function photoCounts(db: Reader, ticketIds: number[]): Promise<Map<number, number>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await db
    .select({ ticketId: photos.ticketId, used: count() })
    .from(photos)
    .where(and(eq(photos.kind, "SUPERVISOR"), inArray(photos.ticketId, ticketIds)))
    .groupBy(photos.ticketId);
  return new Map(rows.map((row) => [row.ticketId!, row.used]));
}

export async function supervisorTickets(
  app: FastifyInstance,
  userId: number,
  status: "pending" | "done",
): Promise<SupervisorTicketView[]> {
  const rows = await app.db
    .select({
      approval: approvals,
      ticket: tickets,
      material: materials.name,
      point: unloadingPoints,
    })
    .from(approvals)
    .innerJoin(tickets, eq(approvals.ticketId, tickets.id))
    .leftJoin(materials, eq(tickets.materialId, materials.id))
    .leftJoin(unloadingPoints, eq(tickets.unloadingPointId, unloadingPoints.id))
    .where(
      and(
        eq(approvals.kind, "SUPERVISOR"),
        eq(tickets.supervisorId, userId),
        eq(tickets.type, "TYPE_1"),
        status === "pending" ? eq(approvals.status, "PENDING") : ne(approvals.status, "PENDING"),
      ),
    )
    .orderBy(desc(approvals.id))
    .limit(LIST_LIMIT);
  const used = await photoCounts(
    app.db,
    rows.map((row) => row.ticket.id),
  );

  return rows.map(({ approval, ticket, material, point }) => ({
    approvalId: approval.id,
    approvalStatus: approval.status,
    decidedAt: approval.decidedAt?.toISOString() ?? null,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    plate: ticket.plate,
    status: ticket.status,
    material,
    supplier: ticket.supplier,
    invoiceWeightKg: ticket.invoiceWeightKg,
    unloadingPoint: point ? { code: point.code, name: point.name } : null,
    firstWeightAt: ticket.firstWeightAt?.toISOString() ?? null,
    plateRead: approval.plateRead,
    plateMatch: approval.plateMatch,
    photosUsed: used.get(ticket.id) ?? 0,
  }));
}

/** One photo of a truck at a time, so the limit of 3 cannot be passed. */
export function createSupervisorPhotoCheck(app: FastifyInstance) {
  const busy = new Set<number>();

  return async function checkPhoto(
    ticketId: number,
    supervisor: { userId: number; actor: Actor },
    upload: Upload,
    gps: { lat: number; lng: number; accuracyM?: number } | null,
  ): Promise<SupervisorPhotoResponse> {
    const waiting = (ticket: TicketRow) => {
      assertOwnTicket(ticket, supervisor.userId);
      if (ticket.status !== "SUPERVISOR_PENDING") {
        throw wrongStage("This truck is not waiting for your check.");
      }
    };
    waiting(await getTicket(app.db, ticketId));
    if (upload.contentType !== "image/jpeg") {
      throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "Send the photo from the camera (JPEG).");
    }
    if (busy.has(ticketId)) {
      throw new AppError(409, "PHOTO_IN_PROGRESS", "The last photo is still being read.");
    }
    busy.add(ticketId);

    try {
      const taken = (await photoCounts(app.db, [ticketId])).get(ticketId) ?? 0;
      if (taken >= MAX_SUPERVISOR_PHOTOS) {
        throw new AppError(
          409,
          "PHOTO_LIMIT",
          `No more than ${MAX_SUPERVISOR_PHOTOS} photos. Reject, or approve as a manual check.`,
        );
      }
      const file = await storeFile(
        { storage: app.storage, db: app.db },
        { data: upload.buffer, contentType: upload.contentType, kind: "SUPERVISOR", ticketId },
      );
      const read = await app.readers.readSupervisorPlate(file.data);
      const demo = (await isDemoActive(app.db, app.hardware)) || read.source === "demo";
      const photosUsed = taken + 1;

      const match = await app.eventTransaction(async (tx) => {
        let ticket = await lockTicket(tx, ticketId);
        waiting(ticket);
        const matches = platesMatch(read.plate ?? "", ticket.plate);
        await tx
          .update(approvals)
          .set({ photoId: file.id, plateRead: read.plate, plateMatch: matches, gps })
          .where(
            and(
              eq(approvals.ticketId, ticketId),
              eq(approvals.kind, "SUPERVISOR"),
              eq(approvals.status, "PENDING"),
            ),
          );
        ticket = await tagDemo(tx, ticket, demo);
        await addEvent(tx, ticketId, "SUPERVISOR_PHOTO", supervisor.actor, {
          photoId: file.id,
          plateRead: read.plate,
          match: matches,
          attempt: photosUsed,
          source: read.source,
          gps,
        });
        emitAfterCommit("ticket:updated", ticketRooms(ticket), {
          ticketId,
          status: ticket.status,
        });
        return matches;
      });

      return {
        photoId: file.id,
        plateRead: read.plate,
        match,
        photosUsed,
        photosLeft: MAX_SUPERVISOR_PHOTOS - photosUsed,
      };
    } finally {
      busy.delete(ticketId);
    }
  };
}
