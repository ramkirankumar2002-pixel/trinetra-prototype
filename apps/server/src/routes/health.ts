import type { HealthResponse } from "@trinetra/shared";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Sql } from "postgres";

/** A host's health check must get an answer even if the database never replies. */
const DATABASE_TIMEOUT_MS = 3000;

async function databaseAnswers(sql: Sql, log: FastifyBaseLogger): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("database did not answer in time")),
      DATABASE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([sql`select 1`, timeout]);
    return true;
  } catch (error) {
    // The reason goes to the log only; it can contain the database address.
    log.warn({ err: error }, "health check: database is down");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function registerHealthRoute(app: FastifyInstance, sql: Sql): void {
  app.get("/api/health", async (request, reply): Promise<HealthResponse> => {
    const up = await databaseAnswers(sql, request.log);
    if (!up) reply.status(503);
    return {
      status: up ? "ok" : "degraded",
      database: up ? "up" : "down",
      service: "trinetra-server",
      time: new Date().toISOString(),
    };
  });
}
