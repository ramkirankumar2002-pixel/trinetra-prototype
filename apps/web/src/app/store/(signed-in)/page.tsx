"use client";

import { RoleShell } from "@/components/role-shell";
import { StoreHomeContent } from "@/components/store/home";

export default function StorePage() {
  return (
    <RoleShell area="store">
      <StoreHomeContent />
    </RoleShell>
  );
}
