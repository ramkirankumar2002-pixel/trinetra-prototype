// No login: the page behind the slip's QR code, and the live summary.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ticketNotFound } from "../tickets/repo";
import { liveSummary, publicTicket } from "../tickets/public";

const params = z.object({ token: z.string().max(100) });

export function registerPublicRoutes(app: FastifyInstance): void {
  app.get("/api/public/tickets/:token", async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) throw ticketNotFound();
    reply.header("cache-control", "no-store");
    return publicTicket(app, parsed.data.token);
  });

  app.get("/api/live/summary", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return liveSummary(app);
  });
}
