"use client";

import { RoleShell } from "@/components/role-shell";
import { Approvals } from "@/components/store/approvals";

export default function StoreApprovalsPage() {
  return (
    <RoleShell area="store">
      <Approvals />
    </RoleShell>
  );
}
