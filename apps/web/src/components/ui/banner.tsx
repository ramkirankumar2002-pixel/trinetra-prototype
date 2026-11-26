import { cn } from "cn";
import type { ReactNode } from "react";
import { TONE_ICONS, TONE_SOFT, TONE_SOLID, type Tone } from "./tone";

/**
 * A strip with a round icon and one or two lines, such as "Please check the details".
 * The words say what happened; the colour only supports them.
 */
export function Banner({
  tone = "info",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  const Icon = TONE_ICONS[tone];
  return (
    <div
      data-tone={tone}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-2.5 kiosk:gap-5 kiosk:rounded-2xl kiosk:border-2 kiosk:px-5 kiosk:py-2",
        TONE_SOFT[tone],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full kiosk:size-14",
          TONE_SOLID[tone],
        )}
      >
        <Icon className="size-4 kiosk:size-9" strokeWidth={3} />
      </span>
      <div className="font-medium kiosk:text-foreground">{children}</div>
    </div>
  );
}
