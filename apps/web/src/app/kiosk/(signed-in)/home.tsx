"use client";

import { RoleShell } from "@/components/role-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/i18n/use-t";

export function KioskHome() {
  const t = useT();
  return (
    <RoleShell area="kiosk">
      <EmptyState title={t("empty.title")}>{t("empty.kiosk")}</EmptyState>
    </RoleShell>
  );
}
