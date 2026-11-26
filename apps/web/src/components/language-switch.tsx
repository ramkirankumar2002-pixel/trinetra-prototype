"use client";

import { LANGUAGES } from "@trinetra/shared";
import { cn } from "cn";
import { Check, Globe } from "lucide-react";
import { useLanguage, useT } from "@/i18n/use-t";
import { Button } from "./ui/button";

/** Both languages, each in its own letters; the chosen one has a tick. */
export function LanguageSwitch({
  onNavy = false,
  className,
}: {
  onNavy?: boolean;
  className?: string;
}) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  return (
    <div role="group" aria-label={t("language.label")} className={cn("flex gap-2", className)}>
      {LANGUAGES.map((option) => (
        <Button
          key={option}
          lang={option}
          size="sm"
          className="min-h-10 flex-1"
          variant={option === language ? "primary" : onNavy ? "nav" : "outline"}
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

/** One big button for the kiosk's rail: it shows the other language, in its letters. */
export function LanguageToggle({ className }: { className?: string }) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const other = language === "en" ? "hi" : "en";
  return (
    <Button variant="dark" lang={other} className={className} onClick={() => setLanguage(other)}>
      <Globe aria-hidden />
      {t(`language.${other}`)}
    </Button>
  );
}
