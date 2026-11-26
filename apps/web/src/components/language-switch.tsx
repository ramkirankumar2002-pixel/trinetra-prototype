"use client";

import { LANGUAGES } from "@trinetra/shared";
import { Check } from "lucide-react";
import { useLanguage, useT } from "@/i18n/use-t";
import { Button } from "./ui/button";

/** Both languages, each in its own letters; the chosen one has a tick. */
export function LanguageSwitch() {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  return (
    <div role="group" aria-label={t("language.label")} className="flex gap-2 kiosk:gap-3">
      {LANGUAGES.map((option) => (
        <Button
          key={option}
          lang={option}
          variant={option === language ? "default" : "outline"}
          aria-pressed={option === language}
          onClick={() => setLanguage(option)}
        >
          {option === language && <Check aria-hidden />}
          {t(`language.${option}`)}
        </Button>
      ))}
    </div>
  );
}
