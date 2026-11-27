"use client";

import { useParams } from "next/navigation";
import { RoleShell } from "@/components/role-shell";
import { Verify } from "@/components/supervisor/verify";

export default function SupervisorVerifyPage() {
  const ticketId = Number(useParams<{ ticketId: string }>().ticketId);
  return (
    <RoleShell
      area="supervisor"
      page={{
        section: "/supervisor/trucks",
        title: "sup.verify.title",
        subtitle: "sup.verify.subtitle",
      }}
    >
      {/* Another truck starts afresh. */}
      <Verify key={ticketId} ticketId={ticketId} />
    </RoleShell>
  );
}
