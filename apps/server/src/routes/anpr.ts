import { emptyBodySchema } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { readTruckPlates } from "../tickets/anpr";
import { userActor } from "../tickets/repo";

export function registerAnprRoutes(app: FastifyInstance): void {
  app.post("/api/anpr", { preHandler: requireRole("KIOSK") }, async (request) => {
    emptyBodySchema.parse(request.body);
    return readTruckPlates(app, userActor(request.user.userId));
  });
}
