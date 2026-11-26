import { cn } from "cn";
import type { ComponentProps } from "react";
import { TONE_ICONS, TONE_SOLID, type Tone } from "./tone";

/** A round light with an icon, and the word beside it. */
export function StatusLight({
  tone,
  label,
  className,
  ...props
}: ComponentProps<"span"> & { tone: Tone; label: string }) {
  const Icon = TONE_ICONS[tone];
  return (
    <span
      role="status"
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-2 text-sm font-semibold kiosk:gap-3 kiosk:text-[2rem]",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full kiosk:size-12",
          TONE_SOLID[tone],
        )}
      >
        <Icon className="size-4 kiosk:size-8" strokeWidth={3} />
      </span>
      {label}
    </span>
  );
}
