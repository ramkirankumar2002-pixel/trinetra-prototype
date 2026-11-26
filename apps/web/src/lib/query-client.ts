// TanStack Query settings for the whole website.
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export const QUERY_RETRIES = 2;
/** Live events say when something changed, so data need not be asked for again at once. */
const STALE_MS = 5000;

export const shouldRetry = (failures: number, error: unknown): boolean =>
  failures < QUERY_RETRIES && error instanceof ApiError && error.retryable;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_MS,
        // A refusal (401, 404, 409) will be the same the second time.
        retry: shouldRetry,
        // The kiosk and the backend may share a hotspot without internet, which the
        // browser calls "offline". Requests must still be tried.
        networkMode: "always",
      },
      mutations: {
        // A press is never repeated by itself: the person decides.
        retry: false,
        networkMode: "always",
      },
    },
  });
}
