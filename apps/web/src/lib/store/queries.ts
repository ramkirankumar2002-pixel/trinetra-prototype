"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  MasterResponse,
  StoreRequestsResponse,
  StoreRequestView,
  StoreSummaryResponse,
  StoreTicketsResponse,
  TicketView,
} from "@trinetra/shared";
import { api } from "../api";

/** Everything of the store officer's pages starts with this key. */
export const STORE_KEY = ["store"] as const;

const isId = (id: number) => Number.isSafeInteger(id) && id > 0;

function useStoreData<T>(key: readonly (string | number)[], path: string, enabled = true) {
  return useQuery({
    queryKey: [...STORE_KEY, ...key],
    queryFn: ({ signal }) => api.get<T>(path, { signal }),
    enabled,
  });
}

export const useStorePending = (enabled = true) =>
  useStoreData<StoreRequestsResponse>(["pending"], "/api/store/requests?status=pending", enabled);

export const useStoreSummary = () =>
  useStoreData<StoreSummaryResponse>(["summary"], "/api/store/summary");

export const useStoreRequest = (id: number) =>
  useStoreData<StoreRequestView>(["request", id], `/api/store/requests/${id}`, isId(id));

export const storeTicketKey = (id: number) => [...STORE_KEY, "ticket", id] as const;

export const useStoreTicket = (id: number | null | undefined) =>
  useStoreData<TicketView>(
    ["ticket", id ?? 0],
    `/api/tickets/${id}`,
    typeof id === "number" && isId(id),
  );

export const useTrucksOnSite = () =>
  useStoreData<StoreTicketsResponse>(["trucks"], "/api/store/trucks");

export function useStoreHistory(search: string) {
  return useQuery({
    queryKey: [...STORE_KEY, "history", search],
    queryFn: ({ signal }) =>
      api.get<StoreTicketsResponse>(`/api/store/history?q=${encodeURIComponent(search)}`, {
        signal,
      }),
    // The old list stays while the new search is on its way.
    placeholderData: keepPreviousData,
  });
}

/** The seeded materials, for the mismatch choice. */
export const useMaterials = (enabled: boolean) =>
  useStoreData<MasterResponse>(["master"], "/api/master", enabled);
