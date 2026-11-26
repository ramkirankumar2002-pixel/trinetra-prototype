import { z } from "zod";
import type { UserRole } from "./domain";

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter a username.")
    .max(50, "That username is too long."),
  // Demo PINs have 4 digits; the plan allows up to 6.
  pin: z.string().regex(/^\d{4,6}$/, "The PIN is 4 to 6 digits."),
});
export type LoginRequest = z.infer<typeof loginSchema>;

/** The logged-in user as the API returns it. */
export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: UserRole;
}

/** Returned by POST /api/auth/login and GET /api/auth/me. */
export interface AuthResponse {
  user: AuthUser;
}

/** Returned by GET /api/auth/socket-token. */
export interface SocketTokenResponse {
  token: string;
  expiresInSeconds: number;
}
