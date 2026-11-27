// How long something has waited for a person, and how loudly to show it. Used by the
// store officer's and the supervisor's pages.
import type { Tone } from "@/components/ui/tone";

export const AMBER_AFTER_MIN = 5;
export const RED_AFTER_MIN = 10;

/** Amber after more than 5 minutes, red after more than 10. */
export function waitTone(minutes: number): Tone {
  if (minutes >= RED_AFTER_MIN) return "stop";
  return minutes >= AMBER_AFTER_MIN ? "wait" : "idle";
}

/** Whole minutes since `from`, and their colour. Null until the browser's clock is read. */
export function waitingFor(from: string, now: number): { minutes: number; tone: Tone } | null {
  if (now === 0) return null;
  const ms = Math.max(0, now - Date.parse(from));
  const minutes = Math.floor(ms / 60_000);
  return { minutes, tone: waitTone(ms / 60_000) };
}
