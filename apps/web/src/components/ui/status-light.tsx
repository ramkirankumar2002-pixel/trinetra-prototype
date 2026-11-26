import { cn } from "cn";
import type { ComponentProps } from "react";
import { TONE_GLOW, TONE_ICONS, TONE_SOLID, type Tone } from "./tone";

/** A round light with an icon, and the word beside it: something that is live. */
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
        "inline-flex items-center gap-2 text-sm font-semibold",
        "kiosk:gap-3 kiosk:rounded-full kiosk:border kiosk:border-border kiosk:bg-card kiosk:py-0.5 kiosk:pr-5 kiosk:pl-2 kiosk:text-[2rem] kiosk:leading-tight",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full kiosk:size-9",
          TONE_SOLID[tone],
          TONE_GLOW[tone],
        )}
      >
        <Icon className="size-3.5 kiosk:size-6" strokeWidth={3.5} />
      </span>
      {label}
    </span>
  );
}
