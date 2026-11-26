"use client";

import { RoleShell } from "@/components/role-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/i18n/use-t";

export function SupervisorHome() {
  const t = useT();
  return (
    <RoleShell area="supervisor">
      <EmptyState title={t("empty.title")}>{t("empty.supervisor")}</EmptyState>
    </RoleShell>
  );
}
