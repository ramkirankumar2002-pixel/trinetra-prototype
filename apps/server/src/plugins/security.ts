import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { webOrigins, type Env } from "../config/env";
import { GENERAL_RATE_LIMIT, LOCAL_RATE_LIMIT, MAX_UPLOAD_BYTES } from "../config/limits";
import { AppError } from "../errors/app-error";

export const SESSION_COOKIE = "trinetra_session";

/** Must run before any route is added, so the rate limit applies to all of them. */
export async function registerSecurityPlugins(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(helmet);

  // A list, so other websites get no CORS permission at all.
  await app.register(cors, {
    origin: webOrigins(env),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });

  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });

  // File types are checked by readUpload() in http/upload.ts.
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20 },
  });

  await app.register(rateLimit, {
    ...(env.NODE_ENV === "development" ? LOCAL_RATE_LIMIT : GENERAL_RATE_LIMIT),
    // The plugin throws what this returns, so the error handler formats it like any other.
    errorResponseBuilder: (_request, context) =>
      new AppError(
        context.statusCode,
        "RATE_LIMITED",
        `Too many requests. Try again in ${context.after}.`,
      ),
  });
}
