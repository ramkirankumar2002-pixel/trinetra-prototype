// No login: the slip's QR code and the projector screen.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ticketNotFound } from "../tickets/repo";
import { liveSummary, publicTicket } from "../tickets/public";

const params = z.object({ ticketNo: z.string().regex(/^[A-Z0-9]{2,10}-\d{8}-\d{4,6}$/) });

export function registerPublicRoutes(app: FastifyInstance): void {
  app.get("/api/public/tickets/:ticketNo", async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) throw ticketNotFound();
    reply.header("cache-control", "no-store");
    return publicTicket(app, parsed.data.ticketNo);
  });

  app.get("/api/live/summary", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return liveSummary(app);
  });
}
