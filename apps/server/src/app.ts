import { WEIGHBRIDGE_ID } from "@trinetra/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { DestinationStream } from "pino";
import { LoginLockout } from "./auth/lockout";
import { registerAuthRoutes } from "./auth/routes";
import type { Env } from "./config/env";
import { createDb } from "./db/client";
import { registerErrorHandling, sendError } from "./errors/handler";
import { loggerOptions } from "./logger";
import { registerSecurityPlugins } from "./plugins/security";
import { registerHealthRoute } from "./routes/health";
import { registerTestRoutes } from "./routes/test-routes";

export interface AppOptions {
  env: Env;
  /** Off by default. A stream lets tests read what was logged. */
  logger?: boolean | DestinationStream;
  /** The clock for the login lock. Tests replace it. */
  now?: () => number;
}

/** Builds the app without listening, so tests can call it with app.inject(). */
export async function buildApp({ env, logger = false, now }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger === false ? false : loggerOptions(logger === true ? undefined : logger),
    // Errors found before a route is chosen, such as a badly encoded address.
    frameworkErrors: (error, request, reply) => void sendError(error, request, reply),
  });

  await registerSecurityPlugins(app, env);
  registerErrorHandling(app);

  // Connects on the first query, so building the app does not need the database.
  const database = createDb(env.DATABASE_URL);
  app.addHook("onClose", () => database.close());

  registerHealthRoute(app, database.sql);
  registerAuthRoutes(app, { env, db: database.db, lockout: new LoginLockout(now) });
  if (env.NODE_ENV === "test") registerTestRoutes(app);

  app.addHook("onReady", async () => {
    app.log.info(`Trinetra backend ready for weighbridge ${WEIGHBRIDGE_ID}`);
  });

  return app;
}
