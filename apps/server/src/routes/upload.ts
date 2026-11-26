// The two routes of the driver's phone. No login: the one-time code is the permission.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UPLOAD_RATE_LIMIT } from "../config/limits";
import { AppError } from "../errors/app-error";
import { readUpload } from "../http/upload";
import { receiveInvoice, uploadInfo } from "../tickets/invoice-upload";

const params = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

function codeOf(value: unknown): string {
  const parsed = params.safeParse(value);
  if (!parsed.success) throw new AppError(404, "INVALID_CODE", "This upload link is not valid.");
  return parsed.data.code;
}

export function registerUploadRoutes(app: FastifyInstance): void {
  const config = { config: { rateLimit: UPLOAD_RATE_LIMIT } };

  app.get("/api/upload/:code", config, async (request, reply) => {
    reply.header("cache-control", "no-store");
    return uploadInfo(app, codeOf(request.params));
  });

  app.post("/api/upload/:code", config, async (request) => {
    const code = codeOf(request.params);
    if (!request.isMultipart()) {
      throw new AppError(400, "NO_FILE", "No file was sent.");
    }
    return receiveInvoice(app, code, () => readUpload(request));
  });
}
