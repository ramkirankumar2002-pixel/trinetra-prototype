// POST /api/tickets: the driver has confirmed the plate. Start a ticket, or continue the
// one this truck started a few minutes ago (build plan sections 6 and 8).
import {
  needsPlateApproval,
  type createTicketSchema,
  type CreateTicketResponse,
} from "@trinetra/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { ABANDON_AFTER_MS } from "../config/limits";
import { SIGNALS } from "../hardware/signals";
import { tickets, transporters, vehicles } from "../db/schema";
import { AppError } from "../errors/app-error";
import { emitAfterCommit, type Transaction } from "../realtime/after-commit";
import { linkPlatePhotos, plateReadData } from "./anpr";
import { PLATE_ATTEMPTS, platesDisagree, type PlateVisit } from "./anpr-session";
import { isDemoActive, tagDemo } from "./demo";
import {
  addEvent,
  changeStatus,
  createApproval,
  findOpenTicket,
  lockTicket,
  nextTicketNumber,
  ticketRooms,
  updateTicket,
  warnFrontBackMismatch,
  type Actor,
  type TicketRow,
} from "./repo";
import { ticketView } from "./view";
import { isWaitingForPerson } from "./waiting";

type StartRequest = z.output<typeof createTicketSchema>;

const notConfirmed = (message: string) => new AppError(409, "PLATE_NOT_CONFIRMED", message);

/**
 * A plate that was not typed must come from the cameras: the one both agree on, or, once
 * the retries are used up, the one of the two that the driver confirms.
 */
function checkConfirmedPlate(request: StartRequest, visit: PlateVisit | undefined): void {
  if (request.manual) return;
  if (!visit) {
    throw new AppError(409, "PLATE_NOT_READ", "Read the number plate first.");
  }
  const { last, attempts } = visit;
  if (last.plate !== null) {
    if (request.plate === last.plate) return;
    throw notConfirmed("The cameras read another plate. Type it on the keypad instead.");
  }
  if (attempts < PLATE_ATTEMPTS) {
    throw notConfirmed("Front and back do not match yet. Read the plate again.");
  }
  if (request.plate !== last.cameras.front.plate && request.plate !== last.cameras.back.plate) {
    throw notConfirmed("Neither camera read this plate. Type it on the keypad instead.");
  }
}

async function transporterOf(tx: Transaction, plate: string): Promise<string | null> {
  const [row] = await tx
    .select({ name: transporters.name })
    .from(vehicles)
    .innerJoin(transporters, eq(vehicles.transporterId, transporters.id))
    .where(eq(vehicles.plate, plate));
  return row?.name ?? null;
}

export async function startTicket(
  app: FastifyInstance,
  request: StartRequest,
  actor: Actor,
): Promise<CreateTicketResponse> {
  const visit = app.anpr.current();
  if (request.photoIds.some((id) => !visit?.photoIds.includes(id))) {
    throw new AppError(400, "UNKNOWN_PHOTO_ID", "These are not photos of this truck.");
  }
  checkConfirmedPlate(request, visit);
  const demo = (await isDemoActive(app.db, app.hardware)) || (visit?.last.demo ?? false);

  const plateData = {
    plate: request.plate,
    manual: request.manual,
    anpr: visit ? plateReadData(visit) : null,
  };

  const { ticketId, resumed } = await app.eventTransaction(async (tx) => {
    // One at a time for each plate, so a double tap cannot start two tickets.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`plate:${request.plate}`}))`);

    const found = await findOpenTicket(tx, request.plate);
    let open: TicketRow | undefined = found ? await lockTicket(tx, found.id) : undefined;

    // Left alone for too long, but the minute job has not reached it yet.
    // A visit waiting for a person is not old, however long they take.
    if (
      open?.status === "STARTED" &&
      Date.now() - open.updatedAt.getTime() >= ABANDON_AFTER_MS &&
      !(await isWaitingForPerson(tx, open))
    ) {
      await changeStatus(tx, open, "ABANDON", { actor: "system" });
      open = undefined;
    }

    const finish = async (ticket: TicketRow) => {
      await linkPlatePhotos(tx, ticket.id, visit?.photoIds ?? []);
      if (visit && platesDisagree(visit.last)) {
        await warnFrontBackMismatch(tx, ticket, actor, {
          front: visit.last.cameras.front.plate,
          back: visit.last.cameras.back.plate,
        });
      }
    };

    if (open) {
      if (open.status !== "STARTED") {
        throw new AppError(409, "OPEN_TICKET", "This truck already has an open ticket.", {
          ticketId: open.id,
          ticketNo: open.ticketNo,
          status: open.status,
        });
      }
      let ticket = await updateTicket(tx, open, { language: request.language });
      ticket = await tagDemo(tx, ticket, demo);
      await addEvent(tx, ticket.id, "TICKET_RESUMED", actor, plateData);
      await finish(ticket);
      return { ticketId: ticket.id, resumed: true };
    }

    const [ticket] = await tx
      .insert(tickets)
      .values({
        ticketNo: await nextTicketNumber(tx, new Date()),
        plate: request.plate,
        language: request.language,
        transporter: await transporterOf(tx, request.plate),
        isDemo: demo,
      })
      .returning();
    await addEvent(tx, ticket!.id, "TICKET_CREATED", actor, { ...plateData, demo });
    emitAfterCommit("ticket:updated", ticketRooms(ticket!), {
      ticketId: ticket!.id,
      status: ticket!.status,
    });

    const previous = await tx
      .select({ status: tickets.status, closedAt: tickets.closedAt, ticketNo: tickets.ticketNo })
      .from(tickets)
      .where(
        and(eq(tickets.plate, request.plate), inArray(tickets.status, ["BLOCKED", "REJECTED"])),
      );
    if (needsPlateApproval(previous, new Date())) {
      // For the store officer: the ticket, or the newest of them, that caused the check.
      const earlier = previous
        .filter((row) => needsPlateApproval([row], new Date()))
        .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0))[0]!;
      await createApproval(
        tx,
        ticket!,
        { kind: "PLATE_WARNING", plateWarningReason: "BLOCKED_HISTORY" },
        "system",
        { earlierTicketNo: earlier.ticketNo, earlierStatus: earlier.status },
      );
    }
    await finish(ticket!);
    return { ticketId: ticket!.id, resumed: false };
  });

  app.anpr.clear();
  const ticket = await ticketView(app.db, app.storage, ticketId);
  const blocked = ticket.plateCheck === "PENDING";
  app.hardware.signals.show(blocked ? SIGNALS.store : SIGNALS.processing);
  return { resumed, ticket };
}
