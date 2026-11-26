import type { KioskStateResponse, MasterResponse } from "@trinetra/shared";
import { asc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { KIOSK_STATE_RATE_LIMIT } from "../config/limits";
import { materials, suppliers, transporters } from "../db/schema";
import type { HardwareState } from "../hardware/state";
import { kioskCollect } from "../tickets/collect";

export function registerKioskRoutes(app: FastifyInstance, state: HardwareState): void {
  const kiosk = { preHandler: requireRole("KIOSK") };

  app.get(
    "/api/kiosk/state",
    {
      ...kiosk,
      // Higher than the general limit, so the kiosk may ask several times a second.
      config: { rateLimit: KIOSK_STATE_RATE_LIMIT },
    },
    async (_request, reply): Promise<KioskStateResponse> => {
      reply.header("cache-control", "no-store");
      return state.snapshot();
    },
  );

  /** The lists the kiosk's tiles are made from. */
  app.get("/api/master", kiosk, async (): Promise<MasterResponse> => {
    const [materialRows, supplierRows, transporterRows] = await Promise.all([
      app.db.select().from(materials).orderBy(asc(materials.id)),
      app.db.select().from(suppliers).orderBy(asc(suppliers.name)),
      app.db.select().from(transporters).orderBy(asc(transporters.name)),
    ]);
    return {
      materials: materialRows.map(({ name, type, type2AboveKg, aliasesEn, aliasesHi }) => ({
        name,
        type,
        type2AboveKg,
        aliasesEn,
        aliasesHi,
      })),
      suppliers: supplierRows.map((row) => row.name),
      transporters: transporterRows.map((row) => row.name),
    };
  });

  app.get("/api/kiosk/collect", kiosk, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return kioskCollect(app);
  });
}
