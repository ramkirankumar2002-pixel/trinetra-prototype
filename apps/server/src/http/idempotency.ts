// "Each action carries a request id, so a double tap never saves two weights" (build plan
// section 13). A logged-in POST, PATCH or PUT may send an Idempotency-Key header. A
// repeat of that key gets the first answer again, and nothing is done a second time.
//
// Only successful answers are remembered: a refused request changed nothing, so the same
// key may try again. Kept in memory, because an answer can hold the plain invoice upload
// code, which the database must never hold. After a restart the ticket statuses and
// request states still stop a second weight or a second decision.
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error";

export const IDEMPOTENCY_HEADER = "idempotency-key";
/** As long as a login. */
const KEEP_MS = 12 * 60 * 60 * 1000;
const MAX_KEYS = 5000;

const METHODS = new Set(["POST", "PATCH", "PUT"]);

interface Answer {
  status: number;
  body: string;
}

interface Entry {
  fingerprint: string;
  /** The first answer, or null if that request failed. */
  answer: Promise<Answer | null>;
  finish: (answer: Answer | null) => void;
  at: number;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set on the request that is doing the work for a key. */
    idempotencyKey?: string;
  }
}

/** The same key must always mean the same request. */
const fingerprintOf = (request: FastifyRequest) =>
  createHash("sha256")
    .update(`${request.method} ${request.url}\n${JSON.stringify(request.body ?? null)}`)
    .digest("hex");

/** Must be called before the routes are added. */
export function registerIdempotency(app: FastifyInstance, now: () => number = Date.now): void {
  const entries = new Map<string, Entry>();

  function makeRoom(): void {
    // A Map keeps its order, so the oldest come first.
    for (const [key, entry] of entries) {
      if (entries.size < MAX_KEYS && now() - entry.at < KEEP_MS) break;
      entries.delete(key);
    }
  }

  async function check(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers[IDEMPOTENCY_HEADER];
    // Only for logged-in users: the role guard has run by now and set request.user.
    if (header === undefined || !request.user) return;
    if (typeof header !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(header)) {
      throw new AppError(400, "BAD_IDEMPOTENCY_KEY", "The Idempotency-Key header is not valid.");
    }
    // Keys belong to a user, so one user can never be given another's answer.
    const key = `${request.user.userId}:${header}`;
    const fingerprint = fingerprintOf(request);

    for (;;) {
      makeRoom();
      const earlier = entries.get(key);
      if (!earlier) break;
      if (earlier.fingerprint !== fingerprint) {
        throw new AppError(
          422,
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key was used for another request.",
        );
      }
      // Waits if the first request is still working, as after a double tap.
      const answer = await earlier.answer;
      if (answer) {
        return reply
          .status(answer.status)
          .header("idempotent-replayed", "true")
          .type("application/json; charset=utf-8")
          .send(answer.body);
      }
      // The first one failed and was forgotten: this one tries.
    }

    let finish!: Entry["finish"];
    const answer = new Promise<Answer | null>((resolve) => (finish = resolve));
    entries.set(key, { fingerprint, answer, finish, at: now() });
    request.idempotencyKey = key;
  }

  app.addHook("onRoute", (route) => {
    const methods = [route.method].flat();
    if (!route.url.startsWith("/api/") || !methods.some((method) => METHODS.has(method))) return;
    // After the route's own checks, so a refused caller never reaches a stored answer.
    route.preHandler = [route.preHandler ?? []].flat().concat(check);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const key = request.idempotencyKey;
    const entry = key === undefined ? undefined : entries.get(key);
    if (key === undefined || !entry) return payload;
    delete request.idempotencyKey;
    const succeeded = reply.statusCode < 300 && typeof payload === "string";
    if (!succeeded) entries.delete(key);
    entry.finish(succeeded ? { status: reply.statusCode, body: payload } : null);
    return payload;
  });
}
