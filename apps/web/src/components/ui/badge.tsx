import { cn } from "cn";
import type { ComponentProps } from "react";
import { TONE_ICONS, TONE_SOFT, type Tone } from "./tone";

/** A short status. The words are required: the colour and icon only support them. */
export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: Omit<ComponentProps<"span">, "children"> & { tone?: Tone; children: string }) {
  const Icon = TONE_ICONS[tone];
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-0.5 text-sm font-semibold",
        "kiosk:gap-3 kiosk:px-5 kiosk:py-1 kiosk:text-[2rem]",
        TONE_SOFT[tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className="size-4 shrink-0 kiosk:size-8" />
      {children}
    </span>
  );
}
