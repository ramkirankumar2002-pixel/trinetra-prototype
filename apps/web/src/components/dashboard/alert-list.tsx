// Recent happenings: a coloured icon, a title that says what happened, a detail and the
// time.
import { cn } from "cn";
import { Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";

const KINDS = {
  info: { icon: Info, colour: "bg-info-soft text-info-ink" },
  wait: { icon: TriangleAlert, colour: "bg-wait-soft text-wait-ink" },
  stop: { icon: OctagonAlert, colour: "bg-stop-soft text-stop-ink" },
} satisfies Record<string, { icon: LucideIcon; colour: string }>;

export interface Alert {
  id: string;
  kind: keyof typeof KINDS;
  title: string;
  detail: string;
  time: string;
}

export function AlertList({ alerts }: { alerts: readonly Alert[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {alerts.map(({ id, kind, title, detail, time }) => {
        const { icon: Icon, colour } = KINDS[kind];
        return (
          <li key={id} data-kind={kind} className="flex items-start gap-3 py-2.5 first:pt-0">
            <span
              aria-hidden
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                colour,
              )}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1 leading-snug">
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-muted-foreground">{detail}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{time}</span>
          </li>
        );
      })}
    </ul>
  );
}
