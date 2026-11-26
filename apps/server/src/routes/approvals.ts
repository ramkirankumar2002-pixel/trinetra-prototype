import { decideSchema } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { decideApproval } from "../tickets/decisions";
import { idOf } from "./params";

export function registerApprovalRoutes(app: FastifyInstance): void {
  app.post(
    "/api/approvals/:id/decide",
    { preHandler: requireRole("SUPERVISOR", "STORE") },
    async (request) => {
      const decision = decideSchema.parse(request.body);
      const { userId, role } = request.user;
      return decideApproval(app, idOf(request.params), decision, { userId, role });
    },
  );
}
