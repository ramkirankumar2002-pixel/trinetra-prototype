import {
  loginSchema,
  type AuthResponse,
  type AuthUser,
  type SocketTokenResponse,
} from "@trinetra/shared";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Env } from "../config/env";
import { LOGIN_RATE_LIMIT, SESSION_SECONDS, SOCKET_TOKEN_SECONDS } from "../config/limits";
import type { Database } from "../db/client";
import { users } from "../db/schema";
import { AppError } from "../errors/app-error";
import { SESSION_COOKIE } from "../plugins/security";
import { readSession } from "./guard";
import { lockedError, type LoginLockout } from "./lockout";

// Compared against when the username does not exist, so both cases take the same time.
const UNUSED_HASH = bcrypt.hashSync("no such user", 10);

const publicColumns = {
  id: users.id,
  username: users.username,
  name: users.name,
  role: users.role,
};

interface AuthRouteOptions {
  env: Env;
  db: Database;
  lockout: LoginLockout;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { env, db, lockout } = options;
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // Also over the local https of "pnpm lan".
    secure: env.NODE_ENV === "production" || env.FRONTEND_ORIGIN.startsWith("https:"),
  } as const;

  app.post(
    "/api/auth/login",
    { config: { rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply): Promise<AuthResponse> => {
      const { username, pin } = loginSchema.parse(request.body);

      const lockIfNeeded = (secondsLeft: number) => {
        reply.header("retry-after", secondsLeft);
        return lockedError(secondsLeft);
      };

      const attempt = lockout.start(username);
      let user: AuthUser | undefined;
      try {
        const [row] = await db
          .select({ ...publicColumns, pinHash: users.pinHash })
          .from(users)
          .where(eq(users.username, username));
        const pinMatches = await bcrypt.compare(pin, row?.pinHash ?? UNUSED_HASH);
        if (row && pinMatches) {
          user = { id: row.id, username: row.username, name: row.name, role: row.role };
        }
      } catch (error) {
        attempt.cancel();
        throw error;
      }

      if (!user) {
        const secondsLeft = attempt.fail();
        if (secondsLeft > 0) throw lockIfNeeded(secondsLeft);
        // The same answer for a wrong PIN and an unknown username.
        throw new AppError(401, "INVALID_CREDENTIALS", "Wrong username or PIN.");
      }
      attempt.succeed();

      const token = app.jwt.sign(
        { userId: user.id, role: user.role, name: user.name, use: "session" },
        { expiresIn: SESSION_SECONDS },
      );
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_SECONDS });
      return { user };
    },
  );

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });

  app.get("/api/auth/me", async (request): Promise<AuthResponse> => {
    const session = await readSession(request);
    // Looked up again, so a user who no longer exists is not reported as logged in.
    const [user] = await db.select(publicColumns).from(users).where(eq(users.id, session.userId));
    if (!user) throw new AppError(401, "NOT_LOGGED_IN", "Please log in.");
    return { user };
  });

  app.get("/api/auth/socket-token", async (request): Promise<SocketTokenResponse> => {
    const { userId, role, name, exp } = await readSession(request);
    const token = app.jwt.sign(
      // sessionEndsAt lets the live connection end when the login does.
      { userId, role, name, use: "socket", ...(exp ? { sessionEndsAt: exp } : {}) },
      { expiresIn: SOCKET_TOKEN_SECONDS },
    );
    return { token, expiresInSeconds: SOCKET_TOKEN_SECONDS };
  });
}
