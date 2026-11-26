import {
  createTicketSchema,
  emptyBodySchema,
  printedSchema,
  ticketDetailsSchema,
} from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import type { Env } from "../config/env";
import { saveDetails } from "../tickets/details";
import { createUploadLink } from "../tickets/invoice-upload";
import { getTicket, userActor } from "../tickets/repo";
import { assertOwnTicket } from "../tickets/supervisor";
import { discardWeight, logPrinted } from "../tickets/slips";
import { startTicket } from "../tickets/start";
import { ticketView } from "../tickets/view";
import { takeFirstWeight, takeSecondWeight } from "../tickets/weighing";
import { idOf } from "./params";

export function registerTicketRoutes(app: FastifyInstance, env: Env): void {
  const kiosk = { preHandler: requireRole("KIOSK") };

  app.post("/api/tickets", kiosk, async (request, reply) => {
    const body = createTicketSchema.parse(request.body);
    const result = await startTicket(app, body, userActor(request.user.userId));
    reply.status(result.resumed ? 200 : 201);
    return result;
  });

  app.post("/api/tickets/:id/upload-link", kiosk, async (request) => {
    emptyBodySchema.parse(request.body);
    return createUploadLink(app, env, idOf(request.params), userActor(request.user.userId));
  });

  app.patch("/api/tickets/:id/details", kiosk, async (request) => {
    const details = ticketDetailsSchema.parse(request.body);
    return saveDetails(app, idOf(request.params), details, userActor(request.user.userId));
  });

  app.post("/api/tickets/:id/first-weight", kiosk, async (request) => {
    // No values at all: the backend has the weight.
    emptyBodySchema.parse(request.body);
    return takeFirstWeight(app, idOf(request.params), userActor(request.user.userId));
  });

  app.post("/api/tickets/:id/second-weight", kiosk, async (request) => {
    emptyBodySchema.parse(request.body);
    return takeSecondWeight(app, idOf(request.params), userActor(request.user.userId));
  });

  app.post("/api/tickets/:id/discard-weight", kiosk, async (request) => {
    emptyBodySchema.parse(request.body);
    return discardWeight(app, idOf(request.params), userActor(request.user.userId));
  });

  app.post("/api/tickets/:id/printed", kiosk, async (request) => {
    const { kind } = printedSchema.parse(request.body);
    return logPrinted(app, idOf(request.params), kind, userActor(request.user.userId));
  });

  app.get(
    "/api/tickets/:id",
    { preHandler: requireRole("KIOSK", "SUPERVISOR", "STORE") },
    async (request, reply) => {
      const id = idOf(request.params);
      if (request.user.role === "SUPERVISOR") {
        assertOwnTicket(await getTicket(app.db, id), request.user.userId);
      }
      reply.header("cache-control", "no-store");
      return ticketView(app.db, app.storage, id);
    },
  );
}
