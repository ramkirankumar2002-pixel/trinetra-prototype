// A ticket's values in two columns, each with its own icon. At 1366×768 under a page
// header, a banner and the action bar there is room for 5 rows: 10 items.
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import { SURFACE } from "../ui/card";

export interface Detail {
  icon: LucideIcon;
  label: string;
  /** Null shows dashes: not known yet. */
  value: string | null;
  /** highlight: the value to notice. live: a good result, in green. */
  emphasis?: "highlight" | "live";
}

export function DetailGrid({ items, className }: { items: Detail[]; className?: string }) {
  return (
    <dl className={cn(SURFACE, "grid grid-cols-2 gap-x-8 px-4 py-1", className)}>
      {items.map(({ icon: Icon, label, value, emphasis }) => (
        <div
          key={label}
          className="flex min-h-16 min-w-0 items-center gap-3 border-b border-border py-1 leading-tight"
        >
          <span
            aria-hidden
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-primary-edge/35 bg-info-soft text-info-ink"
          >
            <Icon className="size-7" />
          </span>
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd
            className={cn(
              "ml-auto min-w-0 text-right font-semibold break-words",
              emphasis === "highlight" && "text-highlight",
              emphasis === "live" && "text-live",
            )}
          >
            {value ?? "———"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
