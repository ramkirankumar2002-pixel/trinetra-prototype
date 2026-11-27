"use client";

import { RoleShell } from "@/components/role-shell";
import { Trucks } from "@/components/supervisor/trucks";

export default function SupervisorTrucksPage() {
  return (
    <RoleShell area="supervisor">
      <Trucks />
    </RoleShell>
  );
}
