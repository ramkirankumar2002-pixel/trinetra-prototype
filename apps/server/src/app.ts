import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

/** Builds the app without listening, so tests can call it with app.inject(). */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.get("/api/health", async () => ({
    status: "ok",
    service: "trinetra-server",
    time: new Date().toISOString(),
  }));

  return app;
}
