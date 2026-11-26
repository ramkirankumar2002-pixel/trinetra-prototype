import type { KioskStateResponse } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { KIOSK_STATE_RATE_LIMIT } from "../config/limits";
import type { HardwareState } from "../hardware/state";

export function registerKioskRoutes(app: FastifyInstance, state: HardwareState): void {
  app.get(
    "/api/kiosk/state",
    {
      preHandler: requireRole("KIOSK"),
      // Higher than the general limit, so the kiosk may ask several times a second.
      config: { rateLimit: KIOSK_STATE_RATE_LIMIT },
    },
    async (_request, reply): Promise<KioskStateResponse> => {
      reply.header("cache-control", "no-store");
      return state.snapshot();
    },
  );
}
