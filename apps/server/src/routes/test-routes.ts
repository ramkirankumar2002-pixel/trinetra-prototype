import { USER_ROLES } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/guard";
import { buzzSchema, displayLinesSchema, lightsSchema } from "../hardware/messages";

const commandSchema = z.discriminatedUnion("t", [
  lightsSchema.extend({ t: z.literal("light") }),
  buzzSchema.pick({ ms: true }).extend({ t: z.literal("buzz") }),
  z.object({ t: z.literal("display"), lines: displayLinesSchema }),
  z.object({ t: z.literal("tare") }),
]);

/**
 * /api/test/kiosk, /api/test/supervisor and /api/test/store, to prove the role guard.
 * POST /api/test/photos asks both cameras for photos, and POST /api/test/command sends one
 * command to the main ESP32 (kiosk only), to try the hardware with the simulator.
 * Added only when NODE_ENV=test.
 */
export function registerTestRoutes(app: FastifyInstance): void {
  const kioskOnly = { preHandler: requireRole("KIOSK") };
  app.post("/api/test/photos", kioskOnly, async () => app.hardware.photos.requestPhotos(null));
  app.post("/api/test/command", kioskOnly, async (request) => {
    const command = commandSchema.parse(request.body);
    const { commands } = app.hardware;
    if (command.t === "light") return commands.setLights(command);
    if (command.t === "buzz") return commands.buzz(command.ms);
    if (command.t === "display") return commands.showLines(command.lines);
    return commands.tare();
  });

  for (const role of USER_ROLES) {
    app.get(
      `/api/test/${role.toLowerCase()}`,
      { preHandler: requireRole(role) },
      async (request) => ({ ok: true, role: request.user.role, name: request.user.name }),
    );
  }
}
