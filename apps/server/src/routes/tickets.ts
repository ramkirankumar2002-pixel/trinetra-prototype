import { createTicketSchema } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { AppError } from "../errors/app-error";
import { getTicket, userActor } from "../tickets/repo";
import { startTicket } from "../tickets/start";
import { ticketView } from "../tickets/view";
import { idOf } from "./params";

export const notYourTicket = () =>
  new AppError(403, "NOT_YOUR_TICKET", "This truck was not sent to you.");

export function registerTicketRoutes(app: FastifyInstance): void {
  const kiosk = { preHandler: requireRole("KIOSK") };

  app.post("/api/tickets", kiosk, async (request, reply) => {
    const body = createTicketSchema.parse(request.body);
    const result = await startTicket(app, body, userActor(request.user.userId));
    reply.status(result.resumed ? 200 : 201);
    return result;
  });

  app.get(
    "/api/tickets/:id",
    { preHandler: requireRole("KIOSK", "SUPERVISOR", "STORE") },
    async (request, reply) => {
      const id = idOf(request.params);
      if (request.user.role === "SUPERVISOR") {
        const ticket = await getTicket(app.db, id);
        if (ticket.type !== "TYPE_1" || ticket.supervisorId !== request.user.userId) {
          throw notYourTicket();
        }
      }
      reply.header("cache-control", "no-store");
      return ticketView(app.db, app.storage, id);
    },
  );
}
