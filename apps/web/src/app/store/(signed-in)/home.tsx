"use client";

import { RoleShell } from "@/components/role-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/i18n/use-t";

export function StoreHome() {
  const t = useT();
  return (
    <RoleShell area="store">
      <EmptyState title={t("empty.title")}>{t("empty.store")}</EmptyState>
    </RoleShell>
  );
}
