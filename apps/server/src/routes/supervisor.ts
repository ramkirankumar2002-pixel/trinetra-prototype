import { listStatusSchema, supervisorPhotoFieldsSchema } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { AppError } from "../errors/app-error";
import { readUploadWithFields } from "../http/upload";
import { userActor } from "../tickets/repo";
import { createSupervisorPhotoCheck, supervisorTickets } from "../tickets/supervisor";
import { idOf } from "./params";

export function registerSupervisorRoutes(app: FastifyInstance): void {
  const supervisor = { preHandler: requireRole("SUPERVISOR") };
  const checkPhoto = createSupervisorPhotoCheck(app);

  app.get("/api/supervisor/tickets", supervisor, async (request, reply) => {
    const { status } = listStatusSchema.parse(request.query);
    reply.header("cache-control", "no-store");
    return { tickets: await supervisorTickets(app, request.user.userId, status) };
  });

  app.post("/api/supervisor/tickets/:id/photo", supervisor, async (request) => {
    const id = idOf(request.params);
    if (!request.isMultipart()) throw new AppError(400, "NO_FILE", "No photo was sent.");
    const { upload, fields } = await readUploadWithFields(request);
    const { lat, lng, accuracyM } = supervisorPhotoFieldsSchema.parse(fields);
    const gps =
      lat === undefined || lng === undefined
        ? null
        : { lat, lng, ...(accuracyM === undefined ? {} : { accuracyM }) };
    const { userId } = request.user;
    return checkPhoto(id, { userId, actor: userActor(userId) }, upload, gps);
  });
}
