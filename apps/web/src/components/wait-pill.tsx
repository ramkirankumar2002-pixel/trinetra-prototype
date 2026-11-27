"use client";

import { useT } from "@/i18n/use-t";
import { useNow } from "@/lib/supervisor/queries";
import { waitingFor } from "@/lib/waiting";
import { StatusPill } from "./ui/status-pill";

/** How long something has waited: amber after 5 minutes, red after 10. */
export function WaitPill({ since }: { since: string }) {
  const t = useT();
  const waiting = waitingFor(since, useNow());
  if (!waiting) return null;
  return (
    <StatusPill tone={waiting.tone} data-testid="wait">
      {t("kpi.minutes", { count: waiting.minutes })}
    </StatusPill>
  );
}
