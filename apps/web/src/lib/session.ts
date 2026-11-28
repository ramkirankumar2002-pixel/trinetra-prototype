"use client";

// Who is logged in, as the backend says (GET /api/auth/me). The login itself is an
// HttpOnly cookie the website cannot read.
import { useQuery } from "@tanstack/react-query";
import type { AuthResponse } from "@trinetra/shared";
import { api } from "./api";
import type { AreaName } from "./areas";

/** Each app has its own login, so each is remembered apart. */
export const meKey = (area: AreaName) => ["me", area] as const;
const SERVER_RETRY_MS = 3000;

/** The server cannot be reached, or is asked too often: asking again later will work. */
export function isTemporary(error: unknown): boolean {
  const known = error as { retryable?: boolean; status?: number } | null;
  return known?.retryable === true || known?.status === 429;
}

/**
 * With `redirectOn401` (the default) an ended login goes to the login page; a login page
 * asks without it.
 */
export function useMe(area: AreaName, options: { redirectOn401?: boolean } = {}) {
  const { redirectOn401 = true } = options;
  return useQuery({
    queryKey: meKey(area),
    queryFn: async ({ signal }) =>
      (await api.get<AuthResponse>("/api/auth/me", { signal, redirectOn401 })).user,
    // Asked again when the window gets focus: another tab may have logged out.
    staleTime: 0,
    // While there is no answer to be had, keep asking.
    refetchInterval: (query) => (isTemporary(query.state.error) ? SERVER_RETRY_MS : false),
  });
}
