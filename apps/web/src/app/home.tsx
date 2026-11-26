"use client";

// The front page. Step 107 adds the three buttons to the three parts.
import { WEIGHBRIDGE_ID } from "@trinetra/shared";
import { LanguageSwitch } from "@/components/language-switch";
import { AuthShell } from "@/components/layout/auth-shell";
import { useT } from "@/i18n/use-t";

export function Home() {
  const t = useT();
  return (
    <AuthShell footer={<LanguageSwitch onNavy />}>
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <h1 className="text-2xl font-bold">{t("app.name")}</h1>
        <p className="text-muted-foreground">
          {t("home.subtitle", { weighbridge: WEIGHBRIDGE_ID })}
        </p>
      </div>
    </AuthShell>
  );
}
