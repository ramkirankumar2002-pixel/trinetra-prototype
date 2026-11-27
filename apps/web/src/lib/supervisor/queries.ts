"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupervisorTicketsResponse, TicketView } from "@trinetra/shared";
import { useSyncExternalStore } from "react";
import { api } from "../api";

/** Everything of the supervisor's lists starts with this key. */
export const SUPERVISOR_KEY = ["supervisor"] as const;

export function useSupervisorTrucks(status: "pending" | "done", enabled = true) {
  return useQuery({
    queryKey: [...SUPERVISOR_KEY, status],
    queryFn: ({ signal }) =>
      api.get<SupervisorTicketsResponse>(`/api/supervisor/tickets?status=${status}`, { signal }),
    enabled,
  });
}

export const supervisorTicketKey = (ticketId: number) =>
  [...SUPERVISOR_KEY, "ticket", ticketId] as const;

/** One truck with its photos. The backend refuses another supervisor's truck. */
export function useSupervisorTicket(ticketId: number) {
  return useQuery({
    queryKey: supervisorTicketKey(ticketId),
    queryFn: ({ signal }) => api.get<TicketView>(`/api/tickets/${ticketId}`, { signal }),
    enabled: Number.isSafeInteger(ticketId) && ticketId > 0,
  });
}

const MINUTE_MS = 60_000;

/** The time now, to the half minute: for "waiting for 5 min". 0 until in the browser. */
export function useNow(): number {
  return useSyncExternalStore(
    (changed) => {
      const timer = setInterval(changed, 5000);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / (MINUTE_MS / 2)) * (MINUTE_MS / 2),
    () => 0,
  );
}
