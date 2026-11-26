import { demoSettingsSchema, demoWeightSchema, emptyBodySchema } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireAdminPin } from "../auth/admin-pin";
import { requireRole } from "../auth/guard";
import { LoginLockout } from "../auth/lockout";
import type { Env } from "../config/env";
import { changeDemoSettings, demoSettings, resetDemoData } from "../tickets/demo-controls";

export function registerDemoRoutes(app: FastifyInstance, env: Env, now?: () => number): void {
  const options = {
    preHandler: [requireRole("KIOSK"), requireAdminPin(env.ADMIN_PIN, new LoginLockout(now))],
  };

  app.get("/api/demo/settings", options, async () => demoSettings(app));

  app.put("/api/demo/settings", options, async (request) =>
    changeDemoSettings(app, demoSettingsSchema.parse(request.body)),
  );

  /**
   * The one place a browser sends a weight, and it is not saved on any ticket from here:
   * it replaces the ESP32's readings, and every ticket weighed with it is tagged demo.
   */
  app.post("/api/demo/weight", options, async (request) => {
    const { kg, stable, positionOk } = demoWeightSchema.parse(request.body);
    app.hardware.simulatedWeight.set({ kg, stable, pos: positionOk });
    app.log.warn({ kg }, "demo: the weight is simulated");
    return demoSettings(app);
  });

  app.post("/api/demo/reset", options, async (request) => {
    emptyBodySchema.parse(request.body);
    return resetDemoData(app);
  });
}
