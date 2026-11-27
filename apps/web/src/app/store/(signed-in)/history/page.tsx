"use client";

import { RoleShell } from "@/components/role-shell";
import { History } from "@/components/store/tickets";

export default function StoreHistoryPage() {
  return (
    <RoleShell area="store">
      <History />
    </RoleShell>
  );
}
