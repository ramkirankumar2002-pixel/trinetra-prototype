// One number that matters: a coloured icon circle, the number, and what it counts. The
// circle's colour only decorates; it is not a status.
import { cn } from "cn";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { SURFACE } from "../ui/card";

const CIRCLES = {
  blue: { circle: "bg-kpi-blue text-kpi-blue-ink", ring: "text-kpi-blue-ink" },
  orange: { circle: "bg-kpi-orange text-kpi-orange-ink", ring: "text-kpi-orange-ink" },
  green: { circle: "bg-kpi-green text-kpi-green-ink", ring: "text-kpi-green-ink" },
  purple: { circle: "bg-kpi-purple text-kpi-purple-ink", ring: "text-kpi-purple-ink" },
} as const;

export type KpiColour = keyof typeof CIRCLES;

const RADIUS = 15.9155; // a circle 100 units round

function ProgressRing({ percent, className }: { percent: number; className: string }) {
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <span className="relative inline-flex size-12 shrink-0 items-center justify-center">
      <svg aria-hidden viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r={RADIUS} fill="none" strokeWidth="3.5" className="stroke-muted" />
        <circle
          cx="18"
          cy="18"
          r={RADIUS}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${value} ${100 - value}`}
          stroke="currentColor"
          className={className}
        />
      </svg>
      <span className="text-xs font-bold">{value}%</span>
    </span>
  );
}

export function KpiCard({
  icon: Icon,
  colour,
  value,
  label,
  trend,
  percent,
}: {
  icon: LucideIcon;
  colour: KpiColour;
  value: string;
  label: string;
  /** A small change, with its words: "+2 since yesterday". */
  trend?: { direction: "up" | "down"; text: string };
  /** A progress ring on the right. */
  percent?: number;
}) {
  const style = CIRCLES[colour];
  const Arrow = trend?.direction === "down" ? ArrowDown : ArrowUp;
  return (
    <div data-testid="kpi" className={cn(SURFACE, "flex items-center gap-3 p-3 md:p-4")}>
      <span
        aria-hidden
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-full md:size-14",
          style.circle,
        )}
      >
        <Icon className="size-5 md:size-7" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-2xl leading-tight font-extrabold md:text-3xl">{value}</p>
        <p className="text-sm leading-tight text-muted-foreground">{label}</p>
        {trend && (
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <Arrow aria-hidden className="size-3.5 shrink-0" />
            {trend.text}
          </p>
        )}
      </div>
      {percent !== undefined && (
        <span className="hidden sm:inline-flex">
          <ProgressRing percent={percent} className={style.ring} />
        </span>
      )}
    </div>
  );
}
