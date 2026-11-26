import type { UserRole } from "@trinetra/shared";

export interface TokenPayload {
  userId: number;
  role: UserRole;
  name: string;
  /**
   * What the token is for. Both kinds are signed with the same secret, so this stops
   * a socket token being used as a login cookie, and the other way round.
   */
  use: "session" | "socket";
  /** Added by the signer. */
  exp?: number;
  /** Socket tokens only: when the login ends, in seconds since 1970. */
  sessionEndsAt?: number;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}
