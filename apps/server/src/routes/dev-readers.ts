// Backend of the /dev/readers test page. Not added in production: it spends API quota.
import { normalizePlate } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/guard";
import { AppError } from "../errors/app-error";
import { readUpload } from "../http/upload";
import { processFile } from "../services/images/pipeline";

const invoiceQuery = z.object({ plate: z.string().max(20).optional() });

/** Nothing uploaded here is saved. */
export function registerDevReaderRoutes(app: FastifyInstance): void {
  const options = {
    preHandler: requireRole("KIOSK"),
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  };

  /** Reads one plate photo with the real services (demo mode does not apply here). */
  app.post("/api/dev/read-plate", options, async (request) => {
    const upload = await readUpload(request);
    const started = performance.now();
    const file = await processFile(upload.buffer, upload.contentType);
    if (file.contentType !== "image/jpeg") {
      throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "A plate needs a photo, not a PDF.");
    }
    const result = await app.readers.readPlate(file.data);
    return { result, totalMs: Math.round(performance.now() - started) };
  });

  /** Reads one invoice. With ocr_mode "pick" the chosen sample comes back instead. */
  app.post("/api/dev/read-invoice", options, async (request) => {
    const { plate } = invoiceQuery.parse(request.query);
    const upload = await readUpload(request);
    const started = performance.now();
    const file = await processFile(upload.buffer, upload.contentType);
    const result = await app.readers.readInvoice(file, plate ? normalizePlate(plate) : null);
    return { result, totalMs: Math.round(performance.now() - started) };
  });
}
