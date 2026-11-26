import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { LOCAL_FILES_PREFIX, type LocalStorage } from "../services/storage/local";

const linkQuery = z.object({ expires: z.coerce.number().int(), sig: z.string() });

/**
 * Serves local-driver files. Public on purpose: the short-lived signature is the permission.
 * (With Supabase, links point at Supabase and this route is not added.)
 */
export function registerFileRoutes(app: FastifyInstance, storage: LocalStorage): void {
  app.get<{ Params: { "*": string } }>(`${LOCAL_FILES_PREFIX}*`, async (request, reply) => {
    const query = linkQuery.safeParse(request.query);
    if (!query.success) {
      throw new AppError(403, "INVALID_LINK", "This file link is not valid.");
    }
    const { data, contentType } = await storage.readSigned(
      request.params["*"],
      query.data.expires,
      query.data.sig,
    );
    return reply.type(contentType).header("cache-control", "private, no-store").send(data);
  });
}
