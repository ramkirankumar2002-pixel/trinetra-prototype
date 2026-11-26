// The two weighings (build plan section 6, rules 4 and 7 to 10). THE BACKEND OWNS THE
// WEIGHT: it comes from one canCapture() answer, and nothing here takes a number from a
// request.
import {
  afterFirstWeightEvent,
  checkTolerance,
  classifyType,
  computeNet,
  DEFAULT_TOLERANCE_PCT,
  firstWeightEvent,
  resolveUnloadingPoint,
  secondWeightEvent,
  type Point,
  type TicketEvent,
  type TicketType,
  type TransitionContext,
  type TripRule,
} from "@trinetra/shared";
import { and, count, eq, gte, isNotNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { materials, tickets, unloadingPoints, unloadingRules, users } from "../db/schema";
import { AppError } from "../errors/app-error";
import type { Transaction } from "../realtime/after-commit";
import { bridgeNotReady } from "./blocked";
import { isDemoActive, tagDemo } from "./demo";
import {
  changeStatus,
  createApproval,
  lockTicket,
  plateCheckOf,
  readNumberSetting,
  readSettings,
  wrongStage,
  type Actor,
  type TicketRow,
} from "./repo";
import { holdReasonOf, ticketView } from "./view";

export interface CapturedWeight {
  kg: number;
  source: "esp32" | "simulated";
}

/** The weight to save, or an error saying why none can be taken now. */
function captureWeight(app: FastifyInstance): CapturedWeight {
  const { state, simulatedWeight } = app.hardware;
  const decision = state.canCapture();
  if (!decision.ok) throw bridgeNotReady(decision.reason);
  return { kg: decision.kg, source: simulatedWeight.current() ? "simulated" : "esp32" };
}

interface DbPoint extends Point {
  id: number;
  supervisor: { id: number; name: string; phone: string | null };
}

/**
 * Locks the material until the transaction ends. Everything that gives out a trip number
 * does this first, so two trucks can never get the same one.
 */
async function lockMaterial(tx: Transaction, materialId: number) {
  const [row] = await tx.select().from(materials).where(eq(materials.id, materialId)).for("update");
  return row!;
}

/** Trips are counted from the last "Reset demo data", if there was one. */
async function nextTripNumber(tx: Transaction, materialId: number, ticketId: number) {
  const from = (await readSettings(tx, ["trip_count_from"])).get("trip_count_from");
  const [row] = await tx
    .select({ trips: count() })
    .from(tickets)
    .where(
      and(
        eq(tickets.materialId, materialId),
        ne(tickets.id, ticketId),
        isNotNull(tickets.tripNo),
        ...(typeof from === "string" ? [gte(tickets.firstWeightAt, new Date(from))] : []),
      ),
    );
  return row!.trips + 1;
}

async function unloadingFor(tx: Transaction, materialId: number, tripNo: number) {
  const rows = await tx
    .select({ rule: unloadingRules, point: unloadingPoints, user: users })
    .from(unloadingRules)
    .innerJoin(unloadingPoints, eq(unloadingRules.pointId, unloadingPoints.id))
    .innerJoin(users, eq(unloadingPoints.supervisorId, users.id));
  const pointOf = ({ point, user }: (typeof rows)[number]): DbPoint => ({
    id: point.id,
    code: point.code,
    name: point.name,
    supervisor: { id: user.id, name: user.name, phone: user.phone },
  });

  // The material's own default if it has one, else the overall default.
  const fallback =
    rows.find((row) => row.rule.isDefault && row.rule.materialId === materialId) ??
    rows.find((row) => row.rule.isDefault && row.rule.materialId === null);
  if (!fallback) throw new Error("There is no default unloading point. Run pnpm db:seed.");

  const rules: TripRule<DbPoint>[] = rows
    .filter((row) => !row.rule.isDefault)
    .map((row) => ({
      materialId: row.rule.materialId!,
      tripFrom: row.rule.tripFrom!,
      tripTo: row.rule.tripTo!,
      point: pointOf(row),
    }));
  return resolveUnloadingPoint(materialId, tripNo, rules, pointOf(fallback));
}

/**
 * Saves a first weight and sends the truck to unload: trip number, unloading point and
 * supervisor, then READY_FOR_UNLOAD, then on to the supervisor (Type 1) or straight to
 * ready for the second weight. For Type 2 this runs when the store officer approves.
 */
export async function sendToUnload(
  tx: Transaction,
  ticket: TicketRow,
  weight: {
    kg: number;
    type: TicketType;
    takenAt: Date;
    /** The move that saves the weight. */
    event: TicketEvent;
    context?: TransitionContext;
    actor: Actor;
    data?: Record<string, unknown>;
  },
): Promise<TicketRow> {
  const materialId = ticket.materialId!;
  await lockMaterial(tx, materialId);
  const tripNo = await nextTripNumber(tx, materialId, ticket.id);
  const { point, supervisor } = await unloadingFor(tx, materialId, tripNo);

  let saved = await changeStatus(tx, ticket, weight.event, {
    actor: weight.actor,
    ...(weight.context ? { context: weight.context } : {}),
    set: {
      type: weight.type,
      firstWeightKg: weight.kg,
      firstWeightAt: weight.takenAt,
      tripNo,
      unloadingPointId: point.id,
      supervisorId: supervisor.id,
    },
    data: {
      ...weight.data,
      kg: weight.kg,
      type: weight.type,
      tripNo,
      unloadingPoint: point.code,
      supervisor: supervisor.name,
    },
  });
  saved = await changeStatus(tx, saved, afterFirstWeightEvent(weight.type), { actor: "system" });
  if (weight.type === "TYPE_1") {
    await createApproval(tx, saved, { kind: "SUPERVISOR" }, "system");
  }
  return saved;
}

export async function takeFirstWeight(app: FastifyInstance, ticketId: number, actor: Actor) {
  await app.eventTransaction(async (tx) => {
    let ticket = await lockTicket(tx, ticketId);
    if (ticket.status !== "STARTED") {
      throw wrongStage("The first weight can only be taken once, at the start.");
    }
    const plateCheck = await plateCheckOf(tx, ticketId);
    if (plateCheck !== "NOT_NEEDED" && plateCheck !== "APPROVED") {
      throw new AppError(
        409,
        "NOT_APPROVED_EARLIER",
        "Not approved earlier. Please go to the store office.",
      );
    }
    if (ticket.materialId === null) {
      throw new AppError(409, "DETAILS_REQUIRED", "Choose the material first.");
    }
    const material = await lockMaterial(tx, ticket.materialId);
    const classified = classifyType(material, ticket.invoiceWeightKg);
    if (!classified.ok) throw new AppError(409, classified.error, classified.reason);
    const demo = await isDemoActive(tx, app.hardware);

    // After every wait for a lock, so the weight is the one on the bridge now.
    const { kg, source } = captureWeight(app);
    const takenAt = new Date();
    ticket = await tagDemo(tx, ticket, demo);
    const move = {
      actor,
      event: firstWeightEvent(classified.type),
      context: { plateCheck },
    };

    if (classified.type === "TYPE_2") {
      // Held, not saved: the store officer decides first.
      ticket = await changeStatus(tx, ticket, move.event, {
        actor,
        context: move.context,
        set: { type: classified.type, heldWeightKg: kg, firstWeightAt: takenAt },
        data: { kg, source, type: classified.type, why: classified.reason },
      });
      await createApproval(tx, ticket, { kind: "STORE_TYPE2" }, "system");
    } else {
      await sendToUnload(tx, ticket, {
        ...move,
        kg,
        type: classified.type,
        takenAt,
        data: { source, why: classified.reason },
      });
    }
  });
  return ticketView(app.db, app.storage, ticketId);
}

/** What the kiosk is told when the truck may not be weighed the second time. */
function checkMayWeighAgain(ticket: TicketRow): void {
  if (ticket.status === "READY_FOR_SECOND") return;
  if (ticket.status === "SUPERVISOR_PENDING") {
    throw new AppError(
      409,
      "WAITING_FOR_SUPERVISOR",
      "This truck is waiting for supervisor approval.",
    );
  }
  if (ticket.status === "BLOCKED") {
    throw new AppError(409, "NOT_APPROVED", "This truck was not approved. Go to the store office.");
  }
  throw wrongStage("This truck is not ready for a second weight.");
}

export async function takeSecondWeight(app: FastifyInstance, ticketId: number, actor: Actor) {
  await app.eventTransaction(async (tx) => {
    let ticket = await lockTicket(tx, ticketId);
    checkMayWeighAgain(ticket);
    const tolerancePct = await readNumberSetting(tx, "tolerance_pct", DEFAULT_TOLERANCE_PCT);
    const demo = await isDemoActive(tx, app.hardware);
    const { kg, source } = captureWeight(app);
    ticket = await tagDemo(tx, ticket, demo);

    const net = computeNet(ticket.firstWeightKg!, kg);
    // Without usable weights or an invoice weight there is nothing to pass.
    const tolerance =
      net.valid && ticket.invoiceWeightKg !== null
        ? checkTolerance(net.netKg, ticket.invoiceWeightKg, tolerancePct)
        : undefined;
    const passed = tolerance?.valid === true && tolerance.pass;
    const variancePct = tolerance?.valid ? tolerance.variancePct : null;
    const holdReason = holdReasonOf(
      { netKg: net.netKg, invoiceWeightKg: ticket.invoiceWeightKg },
      !passed,
    );

    ticket = await changeStatus(tx, ticket, secondWeightEvent(passed), {
      actor,
      set: { secondWeightKg: kg, secondWeightAt: new Date(), netKg: net.netKg, variancePct },
      data: {
        kg,
        source,
        netKg: net.netKg,
        invoiceWeightKg: ticket.invoiceWeightKg,
        variancePct,
        tolerancePct,
        ...(holdReason ? { holdReason } : {}),
      },
    });
    if (!passed) {
      await createApproval(tx, ticket, { kind: "HOLD" }, "system", { holdReason });
    }
  });
  return ticketView(app.db, app.storage, ticketId);
}
