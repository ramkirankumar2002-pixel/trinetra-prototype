// POST /api/approvals/:id/decide: a person's answer to a request, and what it does
// (build plan sections 6, 10 and 11). A decision can never be changed.
import {
  OVERRIDE_REASON_MIN,
  supervisorRoom,
  type decideSchema,
  type Room,
  type TicketEvent,
  type UserRole,
  type WeightChoice,
} from "@trinetra/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { approvals, materials } from "../db/schema";
import { AppError } from "../errors/app-error";
import { emitAfterCommit, type Transaction } from "../realtime/after-commit";
import {
  addEvent,
  changeStatus,
  getTicket,
  lockTicket,
  userActor,
  type Actor,
  type ApprovalRow,
  type TicketRow,
} from "./repo";
import { approvalView, materialNames, ticketView, userNames } from "./view";
import { sendToUnload } from "./weighing";

type Decision = z.output<typeof decideSchema>;

export interface Decider {
  userId: number;
  role: UserRole;
}

type ApprovalChanges = Partial<typeof approvals.$inferInsert>;

const badChoice = (code: string, message: string) => new AppError(400, code, message);

/** A supervisor decides only their own truck checks; the store officer decides the rest. */
async function assertMayDecide(app: FastifyInstance, request: ApprovalRow, who: Decider) {
  const refused = new AppError(403, "NOT_YOUR_REQUEST", "This request is not yours to decide.");
  if (who.role === "STORE") {
    if (request.kind === "SUPERVISOR") throw refused;
    return;
  }
  if (who.role !== "SUPERVISOR" || request.kind !== "SUPERVISOR") throw refused;
  const ticket = await getTicket(app.db, request.ticketId!);
  if (ticket.supervisorId !== who.userId) throw refused;
}

/** Warnings and help calls change nothing: the officer can only mark them as handled. */
const isNotice = (request: ApprovalRow) =>
  request.kind === "DRIVER_HELP" || request.plateWarningReason === "FRONT_BACK_MISMATCH";

interface Effect {
  tx: Transaction;
  ticket: TicketRow;
  request: ApprovalRow;
  decision: Decision;
  approve: boolean;
  actor: Actor;
  /** Saved on the timeline with the move. */
  data: Record<string, unknown>;
}

const move = ({ tx, ticket, actor, data }: Effect, event: TicketEvent) =>
  changeStatus(tx, ticket, event, { actor, data });

const readyToPrint = (ticket: TicketRow) =>
  emitAfterCommit("kiosk:ready", ["kiosk"], {
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    plate: ticket.plate,
  });

const notAllowed = (code: string, message: string) => new AppError(409, code, message);

/** What a supervisor must have done to approve a truck whose photo did not match. */
function checkOverride({ request, decision, ticket }: Effect, changes: ApprovalChanges): void {
  const result = request.matchResult ?? "NOT_READ";
  if (!decision.manualCheck) {
    throw notAllowed(
      "PLATE_NOT_CHECKED",
      "The photo does not match. Take another, or check it yourself.",
    );
  }
  // One character different: "I checked with my eyes" is enough.
  if (result === "CLOSE") return;
  if ((decision.note?.length ?? 0) < OVERRIDE_REASON_MIN) {
    throw notAllowed(
      "REASON_REQUIRED",
      `Type a reason of at least ${OVERRIDE_REASON_MIN} letters.`,
    );
  }
  if (result !== "NOT_READ") return;
  if (!decision.seenPlate) {
    throw notAllowed("SEEN_PLATE_REQUIRED", "Type the number plate you see on the truck.");
  }
  if (decision.seenPlate !== ticket.plate) {
    throw notAllowed(
      "PLATE_DIFFERS",
      "The plate you typed is not this ticket's plate. Check again, or reject the truck.",
    );
  }
  changes.matchResult = "MANUAL";
  changes.manualPlate = decision.seenPlate;
}

async function supervisorDecision(effect: Effect, changes: ApprovalChanges): Promise<void> {
  const { request, approve, data } = effect;
  data.plateRead = request.plateRead;
  data.plateMatch = request.plateMatch;
  data.matchResult = request.matchResult;
  if (!approve) {
    await move(effect, "SUPERVISOR_REJECTED");
    return;
  }
  // Nothing is approved without a live photo of the truck at the unloading point.
  if (!request.photoId) {
    throw notAllowed("PHOTO_REQUIRED", "Take a photo of the number plate first.");
  }
  if (request.matchResult !== "MATCH") {
    checkOverride(effect, changes);
    data.manualCheck = true;
    if (changes.matchResult) {
      data.matchResult = changes.matchResult;
      data.seenPlate = changes.manualPlate;
    }
  }
  await move(effect, "SUPERVISOR_APPROVED");
}

async function type2Decision(effect: Effect): Promise<void> {
  const { tx, ticket, approve, actor, data } = effect;
  if (!approve) {
    await move(effect, "STORE_REJECTED");
    return;
  }
  // The held weight is saved as it was captured; nothing is weighed or typed again.
  const saved = await sendToUnload(tx, ticket, {
    kg: ticket.heldWeightKg!,
    type: "TYPE_2",
    takenAt: ticket.firstWeightAt!,
    event: "STORE_APPROVED",
    actor,
    data,
  });
  readyToPrint(saved);
}

function acceptedKg(ticket: TicketRow, choice: WeightChoice): number {
  const kg = choice === "NET" ? ticket.netKg : ticket.invoiceWeightKg;
  if (kg === null || kg <= 0) {
    throw new AppError(
      409,
      "CHOICE_NOT_AVAILABLE",
      choice === "NET"
        ? "The net weight is not valid, so it cannot be accepted."
        : "This ticket has no invoice weight.",
    );
  }
  return kg;
}

async function holdDecision(effect: Effect, changes: ApprovalChanges): Promise<void> {
  const { ticket, decision, approve, data } = effect;
  if (!approve) {
    await move(effect, "HOLD_REJECTED");
    return;
  }
  const { chosenWeight } = decision;
  if (!chosenWeight) {
    throw badChoice("WEIGHT_CHOICE_REQUIRED", "Choose the net weight or the invoice weight.");
  }
  data.chosenWeight = chosenWeight;
  data.acceptedKg = acceptedKg(ticket, chosenWeight);
  changes.chosenWeight = chosenWeight === "NET" ? "MEASURED_NET" : "INVOICE_WEIGHT";
  readyToPrint(await move(effect, "HOLD_APPROVED"));
}

async function mismatchDecision(effect: Effect, changes: ApprovalChanges): Promise<void> {
  const { tx, ticket, decision, approve, actor, data } = effect;
  if (!approve) {
    await move(effect, "MISMATCH_REJECTED");
    return;
  }
  const name = decision.chosenMaterial?.toLowerCase();
  if (!name) throw badChoice("MATERIAL_CHOICE_REQUIRED", "Choose the correct material.");
  const material = (await tx.select().from(materials)).find(
    (item) => item.name.toLowerCase() === name,
  );
  if (!material) throw badChoice("UNKNOWN_MATERIAL", "That material is not in the list.");
  changes.chosenMaterialId = material.id;
  await changeStatus(tx, ticket, "MISMATCH_RESOLVED", {
    actor,
    set: { materialId: material.id },
    data: { ...data, chosenMaterial: material.name },
  });
}

async function applyEffect(effect: Effect, changes: ApprovalChanges): Promise<void> {
  const { request, approve } = effect;
  if (request.kind === "SUPERVISOR") return supervisorDecision(effect, changes);
  if (request.kind === "STORE_TYPE2") return type2Decision(effect);
  if (request.kind === "HOLD") return holdDecision(effect, changes);
  if (request.kind === "MISMATCH") return mismatchDecision(effect, changes);
  // The blocked-plate check.
  await move(effect, approve ? "PLATE_WARNING_APPROVED" : "PLATE_WARNING_REJECTED");
}

export async function decideApproval(
  app: FastifyInstance,
  approvalId: number,
  decision: Decision,
  who: Decider,
) {
  const missing = new AppError(404, "NOT_FOUND", "There is no such request.");
  const [found] = await app.db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!found) throw missing;
  await assertMayDecide(app, found, who);
  const approve = decision.decision === "APPROVE";
  const actor = userActor(who.userId);

  await app.eventTransaction(async (tx) => {
    // The ticket first, as everywhere else, so two flows cannot block each other.
    const ticket = found.ticketId === null ? null : await lockTicket(tx, found.ticketId);
    const [request] = await tx
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .for("update");
    if (!request) throw missing;
    if (request.status !== "PENDING") {
      throw new AppError(409, "ALREADY_DECIDED", "This request has already been decided.");
    }

    const changes: ApprovalChanges = {
      status: approve ? "APPROVED" : "REJECTED",
      decidedBy: who.userId,
      decidedAt: new Date(),
      // For an approval without a match, the supervisor's note is the reason.
      reason: decision.reason ?? decision.note ?? null,
    };
    const data: Record<string, unknown> = {
      approvalId,
      kind: request.kind,
      decision: decision.decision,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(decision.note ? { note: decision.note } : {}),
    };

    if (isNotice(request)) {
      if (!approve) {
        throw new AppError(409, "CANNOT_REJECT", "This can only be marked as handled.");
      }
      if (ticket) await addEvent(tx, ticket.id, "REQUEST_HANDLED", actor, data);
    } else {
      await applyEffect({ tx, ticket: ticket!, request, decision, approve, actor, data }, changes);
    }
    await tx.update(approvals).set(changes).where(eq(approvals.id, approvalId));

    const rooms: Room[] = ["kiosk", "store"];
    if (request.kind === "SUPERVISOR") rooms.push(supervisorRoom(ticket!.supervisorId!));
    emitAfterCommit("approval:decided", rooms, {
      approvalId,
      ticketId: request.ticketId,
      kind: request.kind,
      status: approve ? "APPROVED" : "REJECTED",
    });
  });

  const [saved] = await app.db.select().from(approvals).where(eq(approvals.id, approvalId));
  const names = await userNames(app.db, [who.userId]);
  return {
    approval: approvalView(saved!, names, await materialNames(app.db)),
    ticket:
      saved!.ticketId === null ? null : await ticketView(app.db, app.storage, saved!.ticketId),
  };
}
