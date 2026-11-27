"use client";

import { RoleShell } from "@/components/role-shell";
import { TrucksOnSite } from "@/components/store/tickets";

export default function StoreTrucksPage() {
  return (
    <RoleShell area="store">
      <TrucksOnSite />
    </RoleShell>
  );
}
