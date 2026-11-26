"use client";

import { Truck } from "lucide-react";
import { RoleShell } from "@/components/role-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/i18n/use-t";

export function KioskHome() {
  const t = useT();
  return (
    <RoleShell area="kiosk">
      <Card className="flex-1">
        <EmptyState icon={Truck} title={t("empty.title")}>
          {t("empty.kiosk")}
        </EmptyState>
      </Card>
    </RoleShell>
  );
}
