// POST /api/anpr: read both plates of the truck on the bridge (build plan section 8).
import {
  CAMERA_IDS,
  type AnprCameraResult,
  type AnprResponse,
  type CameraId,
  type OpenTicket,
  type PlatesRead,
} from "@trinetra/shared";
import { and, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { photos } from "../db/schema";
import { AppError } from "../errors/app-error";
import { PLATE_ATTEMPTS, platesDisagree, type PlateVisit } from "./anpr-session";
import { bridgeNotReady } from "./blocked";
import { tagDemo } from "./demo";
import { photoUrls } from "./photo-links";
import {
  addEvent,
  findOpenTicket,
  lockTicket,
  warnFrontBackMismatch,
  type Actor,
  type TicketRow,
} from "./repo";
import type { Transaction } from "../realtime/after-commit";

/** Gives the plate photos taken before a ticket existed to the ticket. */
export async function linkPlatePhotos(
  tx: Transaction,
  ticketId: number,
  photoIds: string[],
): Promise<void> {
  if (photoIds.length === 0) return;
  await tx
    .update(photos)
    .set({ ticketId })
    .where(and(inArray(photos.id, photoIds), isNull(photos.ticketId)));
}

/** What the timeline keeps about a plate read. */
export const plateReadData = (visit: PlateVisit) => ({
  attempt: visit.attempts,
  front: visit.last.cameras.front.plate,
  back: visit.last.cameras.back.plate,
  sources: {
    front: visit.last.cameras.front.source,
    back: visit.last.cameras.back.source,
  },
  match: visit.last.match,
  demo: visit.last.demo,
});

const openView = (ticket: TicketRow): OpenTicket => ({
  id: ticket.id,
  ticketNo: ticket.ticketNo,
  plate: ticket.plate,
  status: ticket.status,
  language: ticket.language,
});

/** The open ticket of the first plate that has one: the agreed plate, then front, then back. */
async function openTicketFor(app: FastifyInstance, read: PlatesRead) {
  const plates = [read.plate, read.cameras.front.plate, read.cameras.back.plate];
  for (const plate of new Set(plates)) {
    const ticket = plate ? await findOpenTicket(app.db, plate) : undefined;
    if (ticket) return ticket;
  }
  return undefined;
}

export async function readTruckPlates(app: FastifyInstance, actor: Actor): Promise<AnprResponse> {
  const { anpr, hardware } = app;
  const truck = hardware.state.truckCheck();
  if (!truck.ok) throw bridgeNotReady(truck.reason);
  if (anpr.busy) {
    throw new AppError(409, "ANPR_IN_PROGRESS", "The number plate is already being read.");
  }
  anpr.busy = true;
  let visit: PlateVisit;
  try {
    visit = anpr.record(await app.readers.readPlates(null));
  } finally {
    anpr.busy = false;
  }

  const read = visit.last;
  const retriesUsedUp = visit.attempts >= PLATE_ATTEMPTS;
  const open = await openTicketFor(app, read);

  // A truck on its second visit starts no new ticket, so its photos and any warning are
  // saved here. A STARTED ticket is handled when the kiosk resumes it.
  if (open && open.status !== "STARTED" && (read.plate !== null || retriesUsedUp)) {
    await app.eventTransaction(async (tx) => {
      let ticket = await lockTicket(tx, open.id);
      ticket = await tagDemo(tx, ticket, read.demo);
      await linkPlatePhotos(tx, ticket.id, visit.photoIds);
      await addEvent(tx, ticket.id, "PLATE_READ", actor, plateReadData(visit));
      if (platesDisagree(read)) {
        await warnFrontBackMismatch(tx, ticket, actor, {
          front: read.cameras.front.plate,
          back: read.cameras.back.plate,
        });
      }
    });
  }

  const urls = await photoUrls(
    app.db,
    app.storage,
    CAMERA_IDS.map((camera) => read.cameras[camera].photoId),
  );
  const cameraResult = (camera: CameraId): AnprCameraResult => {
    const { plate, source, confidence, validFormat, photoId, cameraFailure } = read.cameras[camera];
    return {
      plate,
      source,
      confidence,
      validFormat,
      photoId,
      photoUrl: photoId ? (urls.get(photoId) ?? null) : null,
      cameraFailure,
    };
  };

  return {
    attempt: visit.attempts,
    retriesLeft: Math.max(0, PLATE_ATTEMPTS - visit.attempts),
    front: cameraResult("front"),
    back: cameraResult("back"),
    sources: { front: read.cameras.front.source, back: read.cameras.back.source },
    match: read.match,
    plate: read.plate,
    canConfirm: read.plate !== null || retriesUsedUp,
    photoIds: visit.photoIds,
    demo: read.demo,
    openTicket: open ? openView(open) : null,
  };
}
