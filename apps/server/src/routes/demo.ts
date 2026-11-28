import { demoSettingsSchema, demoWeightSchema, emptyBodySchema } from "@trinetra/shared";
import type { DemoStatus } from "@trinetra/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAdminPin } from "../auth/admin-pin";
import { requireRole } from "../auth/guard";
import { LoginLockout } from "../auth/lockout";
import type { Env } from "../config/env";
import { isDemoActive } from "../tickets/demo";
import {
  announceDemo,
  changeDemoSettings,
  demoSettings,
  resetDemoData,
} from "../tickets/demo-controls";
import { demoMasterData, demoOverview } from "../tickets/demo-overview";

export function registerDemoRoutes(app: FastifyInstance, env: Env, now?: () => number): void {
  const adminPin = requireAdminPin(env.ADMIN_PIN, new LoginLockout(now));
  const kioskOrStore = requireRole("STORE", "KIOSK");
  /**
   * The settings page is the store officer's: there is no admin role. The helper scripts
   * ("pnpm office", the tests) use the kiosk login together with the admin PIN instead.
   */
  const settings = {
    preHandler: async (request: FastifyRequest) => {
      await kioskOrStore(request);
      if (request.user.role !== "STORE") await adminPin(request);
    },
  };
  /**
   * A simulated weight stays with the kiosk and the admin PIN. The store officer decides
   * about weights, so their login must not be able to make one up.
   */
  const weight = { preHandler: [requireRole("KIOSK"), adminPin] };

  app.get("/api/demo/settings", settings, async () => demoSettings(app));

  app.put("/api/demo/settings", settings, async (request) =>
    changeDemoSettings(app, demoSettingsSchema.parse(request.body)),
  );

  app.get("/api/demo/overview", settings, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return demoOverview(app);
  });

  app.get("/api/demo/master-data", settings, async () => demoMasterData(app));

  /** For the DEMO badge on every signed-in screen: yes or no, nothing else. */
  app.get(
    "/api/demo/status",
    { preHandler: requireRole("KIOSK", "SUPERVISOR", "STORE") },
    async (_request, reply): Promise<DemoStatus> => {
      reply.header("cache-control", "no-store");
      return { demo: await isDemoActive(app.db, app.hardware) };
    },
  );

  /**
   * The one place a browser sends a weight, and it is not saved on any ticket from here:
   * it replaces the ESP32's readings, and every ticket weighed with it is tagged demo.
   */
  app.post("/api/demo/weight", weight, async (request) => {
    const { kg, stable, positionOk } = demoWeightSchema.parse(request.body);
    app.hardware.simulatedWeight.set({ kg, stable, pos: positionOk });
    app.log.warn({ kg }, "demo: the weight is simulated");
    await announceDemo(app);
    return demoSettings(app);
  });

  app.post("/api/demo/reset", settings, async (request) => {
    emptyBodySchema.parse(request.body);
    return resetDemoData(app);
  });
}
