// The big glowing weight. It only shows what the backend sent: no weight ever goes back.
import { formatKg } from "@trinetra/shared";
import { cn } from "cn";
import { SURFACE } from "../ui/card";
import { StatusLight } from "../ui/status-light";
import type { Tone } from "../ui/tone";

export function LiveWeight({
  kg,
  label,
  status,
  className,
}: {
  /** Null while there is no weight to show. */
  kg: number | null;
  label: string;
  status?: { tone: Tone; label: string };
  className?: string;
}) {
  // "32,560 kg": the unit is drawn smaller than the number.
  const [number, unit] = kg === null ? ["———", "kg"] : formatKg(kg).split(" ");
  return (
    <div className={cn(SURFACE, "flex flex-col items-center justify-center gap-6 p-6", className)}>
      <span className="font-semibold tracking-wide text-highlight uppercase">{label}</span>
      <p className="flex items-baseline gap-4 text-live">
        <span className="text-[7rem] leading-none font-bold tabular-nums [text-shadow:0_0_2rem_rgb(50_240_130/60%)]">
          {number}
        </span>
        <span className="text-5xl font-semibold">{unit}</span>
      </p>
      {status && <StatusLight tone={status.tone} label={status.label} />}
    </div>
  );
}
