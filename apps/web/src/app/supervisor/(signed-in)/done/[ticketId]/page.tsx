"use client";

import { useParams } from "next/navigation";
import { RoleShell } from "@/components/role-shell";
import { DoneDetail } from "@/components/supervisor/done";

export default function SupervisorDoneDetailPage() {
  const ticketId = Number(useParams<{ ticketId: string }>().ticketId);
  return (
    <RoleShell
      area="supervisor"
      page={{
        section: "/supervisor/done",
        title: "sup.detail.title",
        subtitle: "page.done.subtitle",
      }}
    >
      <DoneDetail ticketId={ticketId} />
    </RoleShell>
  );
}
