"use client";

import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useT } from "@/i18n/use-t";
import { SETTINGS_PATH } from "@/lib/areas";
import { Button } from "../ui/button";

export function SettingsLink() {
  const t = useT();
  return (
    <Button asChild size="lg" variant="outline">
      <Link href={SETTINGS_PATH}>
        <SlidersHorizontal aria-hidden />
        {t("settings.title")}
      </Link>
    </Button>
  );
}
