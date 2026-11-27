"use client";

import { RoleShell } from "@/components/role-shell";
import { DoneList } from "@/components/supervisor/done";

export default function SupervisorDonePage() {
  return (
    <RoleShell area="supervisor">
      <DoneList />
    </RoleShell>
  );
}
