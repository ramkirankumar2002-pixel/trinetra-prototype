"use client";

// Marks made-up numbers, until Phases 12 and 13 show real ones. It looks unlike a status
// pill (dashed, with a flask) so it cannot be read as one.
import { cn } from "cn";
import { FlaskConical } from "lucide-react";
import { useT } from "@/i18n/use-t";

export function SampleTag({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      data-testid="sample"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-dashed border-kpi-purple-ink/60 bg-kpi-purple px-2 py-0.5 text-xs font-bold text-kpi-purple-ink uppercase",
        className,
      )}
    >
      <FlaskConical aria-hidden className="size-3.5" />
      {t("sample.tag")}
    </span>
  );
}
