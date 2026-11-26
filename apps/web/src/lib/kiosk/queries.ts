// The kiosk's data from the backend. Live events say when to load it again; a slow
// refresh covers an event that was missed.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { KioskCollectResponse, MasterResponse, TicketView } from "@trinetra/shared";
import { useCallback } from "react";
import { api } from "../api";

export const ticketKey = (id: number) => ["ticket", id] as const;
export const COLLECT_KEY = ["kiosk-collect"] as const;

const TICKET_REFRESH_MS = 5000;
const COLLECT_REFRESH_MS = 15_000;

export function useTicket(id: number | null) {
  return useQuery({
    queryKey: ticketKey(id ?? 0),
    queryFn: ({ signal }) => api.get<TicketView>(`/api/tickets/${id}`, { signal }),
    enabled: id !== null,
    staleTime: 0,
    refetchInterval: TICKET_REFRESH_MS,
  });
}

/** Shows the ticket a request answered with, at once. */
export function usePutTicket() {
  const queryClient = useQueryClient();
  return useCallback(
    async (ticket: TicketView) => {
      // An older answer still on its way must not replace this one.
      await queryClient.cancelQueries({ queryKey: ticketKey(ticket.id) });
      queryClient.setQueryData(ticketKey(ticket.id), ticket);
    },
    [queryClient],
  );
}

export function useMaster() {
  return useQuery({
    queryKey: ["master"],
    queryFn: ({ signal }) => api.get<MasterResponse>("/api/master", { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useCollectLists() {
  return useQuery({
    queryKey: COLLECT_KEY,
    queryFn: ({ signal }) => api.get<KioskCollectResponse>("/api/kiosk/collect", { signal }),
    refetchInterval: COLLECT_REFRESH_MS,
  });
}
