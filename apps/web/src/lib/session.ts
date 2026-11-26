"use client";

// Who is logged in, as the backend says (GET /api/auth/me). The login itself is an
// HttpOnly cookie the website cannot read.
import { useQuery } from "@tanstack/react-query";
import type { AuthResponse } from "@trinetra/shared";
import { api } from "./api";

export const ME_KEY = ["me"] as const;
const SERVER_RETRY_MS = 3000;

/**
 * With `redirectOn401` (the default) an ended login goes to the login page; a login page
 * asks without it.
 */
export function useMe(options: { redirectOn401?: boolean } = {}) {
  const { redirectOn401 = true } = options;
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) =>
      (await api.get<AuthResponse>("/api/auth/me", { signal, redirectOn401 })).user,
    // Asked again when the window gets focus: another tab may have logged out.
    staleTime: 0,
    // While the server cannot be reached, keep asking.
    refetchInterval: (query) => {
      const error = query.state.error as { retryable?: boolean } | null;
      return error?.retryable ? SERVER_RETRY_MS : false;
    },
  });
}
