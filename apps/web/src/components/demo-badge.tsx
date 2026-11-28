"use client";

// The small "DEMO" mark on every signed-in screen while a demo replacement is on, so a
// demonstration can never pass for the real thing. LiveConnection asks again when the
// backend says a switch changed.
import { useQuery } from "@tanstack/react-query";
import type { DemoStatus } from "@trinetra/shared";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { StatusPill } from "./ui/status-pill";

/** Everything about the demo settings starts with this key. */
export const DEMO_KEY = ["demo"] as const;

export function DemoBadge({ className }: { className?: string }) {
  const t = useT();
  const { data } = useQuery({
    queryKey: [...DEMO_KEY, "status"],
    queryFn: ({ signal }) => api.get<DemoStatus>("/api/demo/status", { signal }),
  });
  if (!data?.demo) return null;
  return (
    <StatusPill tone="wait" data-testid="demo-badge" {...(className ? { className } : {})}>
      {t("demo.badge")}
    </StatusPill>
  );
}
