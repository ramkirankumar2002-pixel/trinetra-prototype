import { USER_ROLES } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";

/**
 * /api/test/kiosk, /api/test/supervisor and /api/test/store, to prove the role guard.
 * Added only when NODE_ENV=test.
 */
export function registerTestRoutes(app: FastifyInstance): void {
  for (const role of USER_ROLES) {
    app.get(
      `/api/test/${role.toLowerCase()}`,
      { preHandler: requireRole(role) },
      async (request) => ({ ok: true, role: request.user.role, name: request.user.name }),
    );
  }
}
