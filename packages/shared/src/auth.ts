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

/**
 * The website's three apps. Each has its own login cookie, so one browser can be logged in
 * to all three. A page names its app in this header, and the server then reads that app's
 * cookie alone. The header only chooses a cookie: the role in it is still checked.
 */
export const APP_HEADER = "x-trinetra-app";
export const APP_ROLES = {
  kiosk: "KIOSK",
  supervisor: "SUPERVISOR",
  store: "STORE",
} as const satisfies Record<string, UserRole>;

/** Returned by GET /api/auth/socket-token. */
export interface SocketTokenResponse {
  token: string;
  expiresInSeconds: number;
}
