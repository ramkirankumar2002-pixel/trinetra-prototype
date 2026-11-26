import { cn } from "cn";
import type { ComponentProps } from "react";
import { TONE_ICONS, TONE_SOFT, TONE_SOLID, type Tone } from "./tone";

/** A short status. The words are required: the colour and icon only support them. */
export function StatusPill({
  tone = "idle",
  className,
  children,
  ...props
}: Omit<ComponentProps<"span">, "children"> & { tone?: Tone; children: string }) {
  const Icon = TONE_ICONS[tone];
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border py-0.5 pr-2.5 pl-1.5 text-sm font-semibold whitespace-nowrap",
        "kiosk:gap-3 kiosk:rounded-full kiosk:py-1 kiosk:pr-5 kiosk:pl-2 kiosk:text-[2rem]",
        TONE_SOFT[tone],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full kiosk:size-9",
          TONE_SOLID[tone],
        )}
      >
        <Icon className="size-3 kiosk:size-6" strokeWidth={3.5} />
      </span>
      {children}
    </span>
  );
}
