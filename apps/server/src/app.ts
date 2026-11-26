import { WEIGHBRIDGE_ID, type HealthResponse } from "@trinetra/shared";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

/** Builds the app without listening, so tests can call it with app.inject(). */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

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
