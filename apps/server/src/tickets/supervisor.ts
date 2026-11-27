// The supervisor's trucks and their live photo check (build plan section 10).
import {
  comparePlates,
  MAX_SUPERVISOR_PHOTOS,
  type CaptureSource,
  type SupervisorPhotoResponse,
  type SupervisorTicketsResponse,
} from "@trinetra/shared";
import { and, asc, count, desc, eq, gte, inArray, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { approvals, materials, photos, ticketEvents, tickets, unloadingPoints } from "../db/schema";
import { AppError } from "../errors/app-error";
import type { Upload } from "../http/upload";
import { emitAfterCommit } from "../realtime/after-commit";
import { storeFile } from "../services/images/pipeline";
import { isDemoActive, tagDemo } from "./demo";
import { photoUrls } from "./photo-links";
import { startOfDayIST } from "./public";
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

/** Far more than one supervisor can check in a day. */
const LIST_LIMIT = 500;

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

/** The supervisor's photos whose "reading" came from demo mode, not from the photo. */
async function demoReadPhotos(db: Reader, ticketIds: number[]): Promise<Set<unknown>> {
  if (ticketIds.length === 0) return new Set();
  const rows = await db
    .select({ data: ticketEvents.data })
    .from(ticketEvents)
    .where(
      and(eq(ticketEvents.type, "SUPERVISOR_PHOTO"), inArray(ticketEvents.ticketId, ticketIds)),
    );
  return new Set(rows.filter((row) => row.data.source === "demo").map((row) => row.data.photoId));
}

export async function supervisorTickets(
  app: FastifyInstance,
  userId: number,
  status: "pending" | "done",
): Promise<SupervisorTicketsResponse> {
  const query = app.db
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
        status === "pending"
          ? and(eq(approvals.status, "PENDING"), eq(tickets.status, "SUPERVISOR_PENDING"))
          : // Today's decisions only (India time).
            and(
              ne(approvals.status, "PENDING"),
              gte(approvals.decidedAt, startOfDayIST(new Date())),
            ),
      ),
    );
  // Waiting: the truck that has waited longest comes first. Done: the newest first.
  const rows = await (
    status === "pending"
      ? query.orderBy(asc(tickets.firstWeightAt), asc(approvals.id))
      : query.orderBy(desc(approvals.decidedAt), desc(approvals.id))
  ).limit(LIST_LIMIT);
  const urls = await photoUrls(
    app.db,
    app.storage,
    rows.map((row) => row.approval.photoId),
  );
  const points = await app.db
    .select({ code: unloadingPoints.code, name: unloadingPoints.name })
    .from(unloadingPoints)
    .where(eq(unloadingPoints.supervisorId, userId))
    .orderBy(asc(unloadingPoints.id));
  const used = await photoCounts(
    app.db,
    rows.map((row) => row.ticket.id),
  );
  const demoPhotos = await demoReadPhotos(
    app.db,
    rows.map((row) => row.ticket.id),
  );

  const trucks = rows.map(({ approval, ticket, material, point }) => ({
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
    tripNo: ticket.tripNo,
    firstWeightAt: ticket.firstWeightAt?.toISOString() ?? null,
    plateRead: approval.plateRead,
    plateMatch: approval.plateMatch,
    matchResult: approval.matchResult,
    reason: approval.reason,
    photoUrl: approval.photoId ? (urls.get(approval.photoId) ?? null) : null,
    demoReading: approval.photoId !== null && demoPhotos.has(approval.photoId),
    photosUsed: used.get(ticket.id) ?? 0,
  }));
  return { tickets: trucks, points };
}

/** One photo of a truck at a time, so the limit of 3 cannot be passed. */
export function createSupervisorPhotoCheck(app: FastifyInstance) {
  const busy = new Set<number>();

  return async function checkPhoto(
    ticketId: number,
    supervisor: { userId: number; actor: Actor },
    upload: Upload,
    details: {
      captureSource: CaptureSource | null;
      gps: { lat: number; lng: number; accuracyM?: number } | null;
    },
  ): Promise<SupervisorPhotoResponse> {
    const { gps, captureSource } = details;
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

      const result = await app.eventTransaction(async (tx) => {
        let ticket = await lockTicket(tx, ticketId);
        waiting(ticket);
        const matchResult = comparePlates(read.plate, ticket.plate);
        const matches = matchResult === "MATCH";
        await tx
          .update(approvals)
          .set({
            photoId: file.id,
            plateRead: read.plate,
            plateMatch: matches,
            matchResult,
            plateConfidence: read.confidence,
            captureSource,
            manualPlate: null,
            gps,
          })
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
          matchResult,
          confidence: read.confidence,
          captureSource,
          attempt: photosUsed,
          source: read.source,
          gps,
        });
        emitAfterCommit("ticket:updated", ticketRooms(ticket), {
          ticketId,
          status: ticket.status,
        });
        return matchResult;
      });

      return {
        photoId: file.id,
        plateRead: read.plate,
        match: result === "MATCH",
        matchResult: result,
        confidence: read.confidence,
        photosUsed,
        photosLeft: MAX_SUPERVISOR_PHOTOS - photosUsed,
      };
    } finally {
      busy.delete(ticketId);
    }
  };
}
