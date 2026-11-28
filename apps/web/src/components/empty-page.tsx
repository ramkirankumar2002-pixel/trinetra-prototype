"use client";

// A menu page that is not built yet.
import type { ReactNode } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { MENUS, type StaffArea } from "@/lib/menus";
import { RoleShell } from "./role-shell";
import { Card } from "./ui/card";
import { EmptyState } from "./ui/empty-state";

export function EmptyPage({
  area,
  page,
  text,
  children,
}: {
  area: StaffArea;
  page: string;
  text: MessageKey;
  /** Below the card. */
  children?: ReactNode;
}) {
  const t = useT();
  const icon = MENUS[area].find((item) => item.href === `/${area}/${page}`)?.icon;
  return (
    <RoleShell
      area={area}
      {...(area === "store"
        ? {
            page: { section: `/${area}`, title: "menu.profile", subtitle: "page.profile.subtitle" },
          }
        : {})}
    >
      <Card className="min-h-80">
        <EmptyState {...(icon ? { icon } : {})} title={t("empty.title")}>
          {t(text)}
        </EmptyState>
      </Card>
      {children}
    </RoleShell>
  );
}
