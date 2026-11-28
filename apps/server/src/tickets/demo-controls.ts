// The demo settings (build plan section 12): replacements for the hardware and the
// reading services if something fails on stage, and "Reset demo data".
import {
  supervisorRoom,
  type DemoSettings,
  type demoSettingsSchema,
  type Room,
} from "@trinetra/shared";
import { SAMPLE_INVOICE_IDS } from "@trinetra/shared/seed";
import { eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import {
  approvals,
  photos,
  settings,
  ticketEvents,
  tickets,
  uploadLinks,
  users,
  vehicles,
} from "../db/schema";
import { AppError } from "../errors/app-error";
import type { Transaction } from "../realtime/after-commit";
import { loadReaderModes } from "../services/readers/modes";
import { isDemoActive } from "./demo";

/**
 * Tells every signed-in screen whether the DEMO badge belongs there. Sent after every
 * change, also one that leaves the badge as it was: a reset empties their lists.
 */
export async function announceDemo(app: FastifyInstance): Promise<void> {
  const supervisors = await app.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "SUPERVISOR"));
  const rooms: Room[] = ["kiosk", "store", ...supervisors.map((row) => supervisorRoom(row.id))];
  app.realtime.publish("demo:changed", rooms, {
    demo: await isDemoActive(app.db, app.hardware),
  });
}

export async function demoSettings(app: FastifyInstance): Promise<DemoSettings> {
  const modes = await loadReaderModes(app.db);
  const simulated = app.hardware.simulatedWeight.current();
  return {
    anprMode: modes.anpr_mode,
    supervisorMode: modes.supervisor_anpr_mode,
    ocrMode: modes.ocr_mode,
    demoPlate: modes.demo_plate ?? null,
    demoInvoice: modes.demo_invoice ?? null,
    weightMode: simulated ? "simulated" : "real",
    simulatedWeight: simulated
      ? { kg: simulated.kg, stable: simulated.stable, positionOk: simulated.pos }
      : null,
  };
}

async function saveSetting(tx: Transaction, key: string, value: string): Promise<void> {
  await tx
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function changeDemoSettings(
  app: FastifyInstance,
  changes: z.output<typeof demoSettingsSchema>,
): Promise<DemoSettings> {
  const { anprMode, supervisorMode, ocrMode, demoPlate, demoInvoice, weightMode } = changes;
  if (demoPlate !== undefined) {
    const [vehicle] = await app.db.select().from(vehicles).where(eq(vehicles.plate, demoPlate));
    if (!vehicle) {
      throw new AppError(400, "UNKNOWN_PLATE", "Pick a plate from the vehicle list.");
    }
  }
  if (
    demoInvoice !== undefined &&
    !(SAMPLE_INVOICE_IDS as readonly string[]).includes(demoInvoice)
  ) {
    throw new AppError(
      400,
      "UNKNOWN_INVOICE",
      `Pick a sample invoice: ${SAMPLE_INVOICE_IDS.join(", ")}.`,
    );
  }

  await app.db.transaction(async (tx) => {
    const values = {
      anpr_mode: anprMode,
      supervisor_anpr_mode: supervisorMode,
      ocr_mode: ocrMode,
      demo_plate: demoPlate,
      demo_invoice: demoInvoice,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) await saveSetting(tx, key, value);
    }
  });
  if (weightMode === "real") app.hardware.simulatedWeight.stop();
  await announceDemo(app);
  return demoSettings(app);
}

/**
 * Deletes the demo tickets with everything on them, and starts the trip numbers at 1
 * again. Real tickets are untouched, and ticket numbers are never used a second time.
 * Stored photo files stay: stored files are never removed.
 *
 * Help calls made before a ticket existed go too, waiting or answered. They belong to no
 * ticket, so they cannot be tagged demo, and they would stay in the store officer's list.
 */
export async function resetDemoData(app: FastifyInstance): Promise<{ deletedTickets: number }> {
  const deletedTickets = await app.db.transaction(async (tx) => {
    // Lets the database trigger delete the timelines of demo tickets, in this transaction.
    await tx.execute(sql`select set_config('trinetra.demo_reset', 'on', true)`);
    const ids = (
      await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(eq(tickets.isDemo, true))
        .for("update")
    ).map((row) => row.id);
    if (ids.length > 0) {
      // In this order: requests point at photos, and everything points at tickets.
      await tx.delete(approvals).where(inArray(approvals.ticketId, ids));
      await tx.delete(uploadLinks).where(inArray(uploadLinks.ticketId, ids));
      await tx.delete(ticketEvents).where(inArray(ticketEvents.ticketId, ids));
      await tx.delete(photos).where(inArray(photos.ticketId, ids));
      await tx.delete(tickets).where(inArray(tickets.id, ids));
    }
    // Only a help call can be without a ticket (the database checks it).
    await tx.delete(approvals).where(isNull(approvals.ticketId));
    await saveSetting(tx, "trip_count_from", new Date().toISOString());
    return ids.length;
  });
  app.anpr.clear();
  await announceDemo(app);
  return { deletedTickets };
}
