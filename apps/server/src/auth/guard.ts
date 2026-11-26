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
