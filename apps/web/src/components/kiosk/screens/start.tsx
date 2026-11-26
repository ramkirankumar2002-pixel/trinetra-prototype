"use client";

// Screen 2, the language, and screen 3, which appears only while the truck is not fully
// on the bridge.
import { LANGUAGES, type Language } from "@trinetra/shared";
import { cn } from "cn";
import { Globe, Languages, TriangleAlert, Truck } from "lucide-react";
import { translate } from "@/i18n/translate";
import { useLanguage, useT } from "@/i18n/use-t";
import { useKiosk } from "@/lib/kiosk/flow";
import { ActionCard } from "../action-card";
import { KioskFrame } from "../frame";

export function LanguageScreen() {
  const t = useT();
  const { setLanguage } = useLanguage();
  const goTo = useKiosk((state) => state.goTo);
  const choose = (language: Language) => {
    setLanguage(language);
    goTo("plate");
  };
  return (
    <KioskFrame header={{ icon: Languages, title: t("language.label") }}>
      {/* Both at once: the driver has not chosen yet. */}
      <div className="text-center font-bold">
        {LANGUAGES.map((language) => (
          <p key={language} lang={language}>
            {translate(language, "kiosk.language.question")}
          </p>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-8 px-8">
        {LANGUAGES.map((language) => (
          <ActionCard
            key={language}
            lang={language}
            tone={language === "en" ? "blue" : "teal"}
            icon={Globe}
            title={translate(language, `language.${language}`)}
            description={translate(language, "kiosk.language.tap")}
            onClick={() => choose(language)}
          />
        ))}
      </div>
    </KioskFrame>
  );
}

export function PositionScreen() {
  const t = useT();
  return (
    <KioskFrame
      header={{
        icon: TriangleAlert,
        title: t("kiosk.position.heading"),
        subtitle: t("kiosk.position.subtitle"),
      }}
    >
      <div
        data-testid="position"
        role="alert"
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border-4 border-stop-edge bg-stop-soft p-6 text-center shadow-stop",
        )}
      >
        <div aria-hidden className="flex w-full max-w-3xl flex-col items-center">
          {/* The truck hangs over the end of the bridge. */}
          <Truck className="size-52 translate-x-40 text-stop-ink" strokeWidth={1} />
          <div className="-mt-6 h-5 w-96 rounded-full border-4 border-dashed border-foreground/80" />
        </div>
        <p className="flex items-center gap-5 text-[3.25rem] leading-tight font-extrabold text-balance">
          <TriangleAlert aria-hidden className="size-16 shrink-0 text-stop-ink" />
          {t("kiosk.position.title")}
        </p>
      </div>
    </KioskFrame>
  );
}
