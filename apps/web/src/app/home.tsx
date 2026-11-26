"use client";

import { WEIGHBRIDGE_ID } from "@trinetra/shared";
import { LanguageSwitch } from "@/components/language-switch";
import { PageShell } from "@/components/layout/page-shell";
import { useT } from "@/i18n/use-t";

export function Home() {
  const t = useT();
  return (
    <PageShell layout="phone" brand={t("app.name")} bottomBar={<LanguageSwitch />}>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <h1 className="text-4xl font-bold">{t("app.name")}</h1>
        <p className="text-xl text-muted-foreground">
          {t("home.subtitle", { weighbridge: WEIGHBRIDGE_ID })}
        </p>
      </div>
    </PageShell>
  );
}
