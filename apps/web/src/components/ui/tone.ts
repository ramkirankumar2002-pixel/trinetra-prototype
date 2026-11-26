import { Check, Hourglass, Info, Minus, X, type LucideIcon } from "lucide-react";

/**
 * info = blue (arrived), wait = orange (pending), go = green (done, approved),
 * stop = red (rejected, blocked), idle = grey (not started).
 * A colour always comes with its icon and a word.
 */
export type Tone = "info" | "wait" | "go" | "stop" | "idle";

export const TONES: readonly Tone[] = ["info", "wait", "go", "stop", "idle"];

export const TONE_ICONS: Record<Tone, LucideIcon> = {
  info: Info,
  wait: Hourglass,
  go: Check,
  stop: X,
  idle: Minus,
};

/** A tinted background with readable text: pills, banners, messages. */
export const TONE_SOFT: Record<Tone, string> = {
  info: "border-info/35 bg-info-soft text-info-ink",
  wait: "border-wait/50 bg-wait-soft text-wait-ink",
  go: "border-go-edge/45 bg-go-soft text-go-ink",
  stop: "border-stop-edge/55 bg-stop-soft text-stop-ink",
  idle: "border-idle/30 bg-idle-soft text-idle-ink",
};

/** A full colour: lights and icon circles. */
export const TONE_SOLID: Record<Tone, string> = {
  info: "bg-info text-info-foreground",
  wait: "bg-wait text-wait-foreground",
  go: "bg-go text-go-foreground",
  stop: "bg-stop text-stop-foreground",
  idle: "bg-idle text-idle-foreground",
};

/** On the kiosk, lights glow in their own colour. */
export const TONE_GLOW: Record<Tone, string> = {
  info: "kiosk:shadow-[0_0_1rem_var(--info)]",
  wait: "kiosk:shadow-[0_0_1rem_var(--wait)]",
  go: "kiosk:shadow-[0_0_1rem_var(--go-edge)]",
  stop: "kiosk:shadow-[0_0_1rem_var(--stop-edge)]",
  idle: "",
};
