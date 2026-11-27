"use client";

import { useParams } from "next/navigation";
import { RoleShell } from "@/components/role-shell";
import { RequestDetail } from "@/components/store/request-detail";

export default function StoreRequestPage() {
  const approvalId = Number(useParams<{ approvalId: string }>().approvalId);
  return (
    <RoleShell
      area="store"
      page={{
        section: "/store/approvals",
        title: "store.request.title",
        subtitle: "store.request.subtitle",
      }}
    >
      {/* Another request starts afresh. */}
      <RequestDetail key={approvalId} approvalId={approvalId} />
    </RoleShell>
  );
}
