import { helpSchema, listStatusSchema } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { userActor } from "../tickets/repo";
import { askForHelp, storeRequests } from "../tickets/store";

export function registerStoreRoutes(app: FastifyInstance): void {
  app.get("/api/store/requests", { preHandler: requireRole("STORE") }, async (request, reply) => {
    const { status } = listStatusSchema.parse(request.query);
    reply.header("cache-control", "no-store");
    return storeRequests(app, status);
  });

  app.post("/api/help", { preHandler: requireRole("KIOSK") }, async (request) => {
    const body = helpSchema.parse(request.body);
    return askForHelp(app, body?.ticketId ?? null, userActor(request.user.userId));
  });
}
