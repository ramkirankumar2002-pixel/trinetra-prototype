// The minute job: a STARTED ticket nobody has touched for 10 minutes means the driver
// left before the first weight (build plan section 6). Not while the visit waits for a
// person's decision: then it is the person who is slow, not a driver who has gone.
import { and, eq, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ABANDON_AFTER_MS } from "../config/limits";
import { tickets } from "../db/schema";
import { changeStatus, lockTicket } from "./repo";
import { isWaitingForPerson } from "./waiting";

export const SWEEP_EVERY_MS = 60_000;

/** Abandons every STARTED ticket the driver left alone for too long. Returns how many. */
export async function sweepAbandoned(app: FastifyInstance, now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - ABANDON_AFTER_MS);
  const stale = await app.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.status, "STARTED"), lte(tickets.updatedAt, limit)));

  let abandoned = 0;
  for (const { id } of stale) {
    abandoned += await app.eventTransaction(async (tx) => {
      const ticket = await lockTicket(tx, id);
      // Looked at again under the lock: the driver may just have come back.
      if (ticket.status !== "STARTED" || ticket.updatedAt > limit) return 0;
      if (await isWaitingForPerson(tx, ticket)) return 0;
      await changeStatus(tx, ticket, "ABANDON", {
        actor: "system",
        data: { reason: "No activity for 10 minutes." },
      });
      return 1;
    });
  }
  return abandoned;
}

export function scheduleAbandonedSweep(app: FastifyInstance, everyMs = SWEEP_EVERY_MS): void {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;

  const run = async () => {
    try {
      const abandoned = await sweepAbandoned(app);
      if (abandoned > 0) app.log.info({ abandoned }, "abandoned tickets nobody came back to");
    } catch (error) {
      // The next minute tries again.
      app.log.warn({ err: error }, "could not check for abandoned tickets");
    }
  };

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      // A slow run is not joined by a second one.
      running ??= run().finally(() => (running = undefined));
    }, everyMs).unref();
  });
  app.addHook("preClose", async () => {
    clearInterval(timer);
    await running;
  });
}
