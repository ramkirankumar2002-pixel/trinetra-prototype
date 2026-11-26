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
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}
