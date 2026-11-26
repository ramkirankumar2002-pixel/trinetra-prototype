// The demo settings need the kiosk login AND the admin PIN, sent in a header.
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error";
import type { LoginLockout } from "./lockout";

export const ADMIN_PIN_HEADER = "x-admin-pin";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Use after requireRole(). 5 wrong PINs lock the demo settings for a minute. */
export function requireAdminPin(adminPin: string | undefined, lockout: LoginLockout) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!adminPin) {
      throw new AppError(
        503,
        "DEMO_NOT_CONFIGURED",
        "The demo settings are switched off: ADMIN_PIN is not set on the server.",
      );
    }
    const given = request.headers[ADMIN_PIN_HEADER];
    const wrong = new AppError(403, "WRONG_ADMIN_PIN", "Wrong admin PIN.");
    // No PIN at all is not a guess, so it does not count towards the lock.
    if (typeof given !== "string") throw wrong;
    const attempt = lockout.start("admin-pin");
    if (timingSafeEqual(digest(given), digest(adminPin))) {
      attempt.succeed();
      return;
    }
    attempt.fail();
    throw wrong;
  };
}
