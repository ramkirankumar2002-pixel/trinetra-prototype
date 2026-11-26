import type { UserRole } from "@trinetra/shared";
import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error";
import type { TokenPayload } from "./tokens";

const notLoggedIn = () => new AppError(401, "NOT_LOGGED_IN", "Please log in.");

/** Returns who is logged in, read from the cookie only. Otherwise throws 401. */
export async function readSession(request: FastifyRequest): Promise<TokenPayload> {
  let payload: TokenPayload;
  try {
    payload = await request.jwtVerify<TokenPayload>({ onlyCookie: true });
  } catch {
    // Missing, expired and forged cookies all look the same to the caller.
    throw notLoggedIn();
  }
  if (payload.use !== "session") throw notLoggedIn();
  return payload;
}

/**
 * The role guard. Every route that is not public uses it:
 *   app.get("/api/store/requests", { preHandler: requireRole("STORE") }, handler)
 * Answers 401 without a login and 403 for any other role. Afterwards request.user is set.
 */
export function requireRole(...roles: [UserRole, ...UserRole[]]) {
  return async (request: FastifyRequest): Promise<void> => {
    const { role } = await readSession(request);
    if (!roles.includes(role)) {
      throw new AppError(403, "WRONG_ROLE", "Your account is not allowed to do this.");
    }
  };
}
