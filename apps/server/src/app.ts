import { WEIGHBRIDGE_ID, type HealthResponse } from "@trinetra/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { DestinationStream } from "pino";
import type { Env } from "./config/env";
import { loggerOptions } from "./logger";
import { registerSecurityPlugins } from "./plugins/security";

export interface AppOptions {
  env: Env;
  /** Off by default. A stream lets tests read what was logged. */
  logger?: boolean | DestinationStream;
}

/** Builds the app without listening, so tests can call it with app.inject(). */
export async function buildApp({ env, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger === false ? false : loggerOptions(logger === true ? undefined : logger),
  });

  await registerSecurityPlugins(app, env);

  app.addHook("onReady", async () => {
    app.log.info(`Trinetra backend ready for weighbridge ${WEIGHBRIDGE_ID}`);
  });

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "trinetra-server",
    time: new Date().toISOString(),
  }));

  return app;
}
