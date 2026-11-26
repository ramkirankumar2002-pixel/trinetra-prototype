"use client";

// The one question screen: big tiles to tap, one answer each (materials, suppliers,
// transporters). A message above them says why the question is asked again.
import { cn } from "cn";
import { Check, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Banner } from "../ui/banner";
import type { Tone } from "../ui/tone";

export interface Choice {
  value: string;
  label: string;
  icon: LucideIcon;
}

export function ChoiceTiles({
  label,
  choices,
  selected,
  columns = 3,
  message,
  disabled,
  onPick,
}: {
  /** What is being chosen, for screen readers. */
  label: string;
  choices: Choice[];
  /** The answer already saved, shown with a tick. */
  selected?: string | null;
  columns?: 2 | 3;
  message?: { tone: Tone; text: ReactNode } | null;
  disabled?: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {message && (
        <Banner tone={message.tone}>
          <span role="alert">{message.text}</span>
        </Banner>
      )}
      <div
        role="group"
        aria-label={label}
        className={cn(
          "grid min-h-0 flex-1 auto-rows-fr gap-3",
          columns === 3 ? "grid-cols-3" : "grid-cols-2",
        )}
      >
        {choices.map(({ value, label: text, icon: Icon }) => {
          const chosen = value === selected;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={chosen}
              disabled={disabled}
              onClick={() => onPick(value)}
              className={cn(
                "flex min-h-24 min-w-0 items-center gap-4 rounded-3xl border-2 bg-linear-to-b px-4 text-left leading-tight font-bold text-foreground backdrop-blur-md outline-none",
                "from-[rgb(20_80_190/45%)] to-[rgb(6_26_66/70%)] shadow-[0_0_1.25rem_rgb(30_110_255/20%)]",
                "transition-[filter] hover:brightness-110 focus-visible:ring-4 focus-visible:ring-ring disabled:opacity-45",
                chosen ? "border-go-edge shadow-go" : "border-primary-edge/70",
              )}
            >
              <Icon
                aria-hidden
                className="size-14 shrink-0 text-highlight drop-shadow-[0_0_0.75rem_rgb(60_150_255/75%)]"
                strokeWidth={1.5}
              />
              <span className="min-w-0 flex-1 break-words">{text}</span>
              {chosen && <Check aria-hidden className="size-10 shrink-0 text-live" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
