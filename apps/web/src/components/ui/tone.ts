import { Check, Hourglass, Info, X, type LucideIcon } from "lucide-react";

/** go = green, wait = orange, stop = red. Colour always comes with an icon and a word. */
export type Tone = "go" | "wait" | "stop" | "neutral";

export const TONE_ICONS: Record<Tone, LucideIcon> = {
  go: Check,
  wait: Hourglass,
  stop: X,
  neutral: Info,
};

export const TONE_SOFT: Record<Tone, string> = {
  go: "border-go bg-go-soft text-go-ink",
  wait: "border-wait bg-wait-soft text-wait-ink",
  stop: "border-stop bg-stop-soft text-stop-ink",
  neutral: "border-neutral-300 bg-neutral-100 text-neutral-800",
};

export const TONE_SOLID: Record<Tone, string> = {
  go: "bg-go text-go-foreground",
  wait: "bg-wait text-wait-foreground",
  stop: "bg-stop text-stop-foreground",
  neutral: "bg-neutral-500 text-white",
};
