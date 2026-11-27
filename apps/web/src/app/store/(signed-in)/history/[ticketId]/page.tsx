"use client";

import { useParams } from "next/navigation";
import { RoleShell } from "@/components/role-shell";
import { TicketPage } from "@/components/store/tickets";

export default function StoreEndedTicketPage() {
  const ticketId = Number(useParams<{ ticketId: string }>().ticketId);
  return (
    <RoleShell
      area="store"
      page={{
        section: "/store/history",
        title: "store.ticket.title",
        subtitle: "store.ticket.subtitle",
      }}
    >
      <TicketPage key={ticketId} ticketId={ticketId} from="history" />
    </RoleShell>
  );
}
