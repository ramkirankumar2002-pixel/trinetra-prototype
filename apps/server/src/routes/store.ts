import { helpSchema, listStatusSchema, storeHistorySchema } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { AppError } from "../errors/app-error";
import { readUpload } from "../http/upload";
import { receiveStoreInvoice } from "../tickets/invoice-upload";
import { userActor } from "../tickets/repo";
import { storeHistory, storeSummary, trucksOnSite } from "../tickets/store-lists";
import { askForHelp, storeRequest, storeRequests } from "../tickets/store";
import { idOf } from "./params";

export function registerStoreRoutes(app: FastifyInstance): void {
  const store = { preHandler: requireRole("STORE") };

  app.get("/api/store/requests", store, async (request, reply) => {
    const { status } = listStatusSchema.parse(request.query);
    reply.header("cache-control", "no-store");
    return storeRequests(app, status);
  });

  app.get("/api/store/requests/:id", store, async (request, reply) => {
    reply.header("cache-control", "no-store");
    return storeRequest(app, idOf(request.params));
  });

  /** The bill of a driver without a phone, in answer to their call for help. */
  app.post("/api/store/requests/:id/invoice", store, async (request, reply) => {
    const id = idOf(request.params);
    if (!request.isMultipart()) throw new AppError(400, "NO_FILE", "No file was sent.");
    const answer = await receiveStoreInvoice(app, id, request.user.userId, () =>
      readUpload(request),
    );
    // "Accepted": the invoice is still being read.
    reply.status(202);
    return answer;
  });

  app.get("/api/store/summary", store, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return storeSummary(app);
  });

  app.get("/api/store/trucks", store, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return trucksOnSite(app);
  });

  app.get("/api/store/history", store, async (request, reply) => {
    const { q } = storeHistorySchema.parse(request.query);
    reply.header("cache-control", "no-store");
    return storeHistory(app, q);
  });

  app.post("/api/help", { preHandler: requireRole("KIOSK") }, async (request) => {
    const body = helpSchema.parse(request.body);
    return askForHelp(app, body?.ticketId ?? null, userActor(request.user.userId));
  });
}
