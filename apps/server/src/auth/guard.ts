import { APP_HEADER, APP_ROLES, USER_ROLES, type UserRole } from "@trinetra/shared";
import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error";
import { SESSION_COOKIES } from "../plugins/security";
import type { TokenPayload } from "./tokens";

const notLoggedIn = () => new AppError(401, "NOT_LOGGED_IN", "Please log in.");

/**
 * The role of the app that sent the request, from its header: "kiosk" is KIOSK. Undefined
 * without a header (the scripts, curl, /dev pages); an unknown name is no role at all.
 */
export function appRole(request: FastifyRequest): UserRole | null | undefined {
  const app = request.headers[APP_HEADER];
  if (app === undefined) return undefined;
  return typeof app === "string" && Object.hasOwn(APP_ROLES, app)
    ? APP_ROLES[app as keyof typeof APP_ROLES]
    : null;
}

/** The login in one app's cookie, if it is a good one and really of that role. */
function sessionIn(request: FastifyRequest, role: UserRole): TokenPayload | undefined {
  const token = request.cookies[SESSION_COOKIES[role]];
  if (!token) return undefined;
  try {
    const payload = request.server.jwt.verify<TokenPayload>(token);
    return payload.use === "session" && payload.role === role ? payload : undefined;
  } catch {
    // Expired and forged cookies look the same as none.
    return undefined;
  }
}

/**
 * Returns who is logged in, read from the cookies only. Otherwise throws 401.
 *
 * Each app has its own cookie, so one browser can be logged in to all three. A request that
 * names its app is judged by that app's cookie alone. One that names none is judged by the
 * cookie whose role the route allows (`wanted`), or else the first one it has.
 */
export async function readSession(
  request: FastifyRequest,
  wanted?: readonly UserRole[],
): Promise<TokenPayload> {
  const named = appRole(request);
  const looked = named === undefined ? USER_ROLES : named === null ? [] : [named];
  const sessions = looked.flatMap((role) => sessionIn(request, role) ?? []);
  const session = sessions.find((item) => !wanted || wanted.includes(item.role)) ?? sessions[0];
  if (!session) throw notLoggedIn();
  return session;
}

/**
 * The role guard. Every route that is not public uses it:
 *   app.get("/api/store/requests", { preHandler: requireRole("STORE") }, handler)
 * Answers 401 without a login and 403 for any other role. Afterwards request.user is set.
 */
export function requireRole(...roles: [UserRole, ...UserRole[]]) {
  return async (request: FastifyRequest): Promise<void> => {
    const session = await readSession(request, roles);
    if (!roles.includes(session.role)) {
      throw new AppError(403, "WRONG_ROLE", "Your account is not allowed to do this.");
    }
    request.user = session;
  };
}
