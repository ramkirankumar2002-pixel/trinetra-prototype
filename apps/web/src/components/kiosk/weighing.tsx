"use client";

// The weighing screens' ring: it fills over 3 seconds while the backend says a weight can
// be taken, and empties the moment it cannot. It only shows: the backend decides, and
// takes the weight itself.
import { cn } from "cn";
import { Check, Hourglass } from "lucide-react";
import { useEffect, useRef } from "react";

export const RING_MS = 3000;

const RADIUS = 52;
const LENGTH = 2 * Math.PI * RADIUS;

export function WeighingRing({
  canCapture,
  settled,
  onSettled,
  text,
  durationMs = RING_MS,
}: {
  canCapture: boolean;
  /** The ring has filled. */
  settled: boolean;
  onSettled: () => void;
  /** Why a weight cannot be taken now; empty when the heading says all there is to say. */
  text: string;
  durationMs?: number;
}) {
  const latest = useRef(onSettled);
  useEffect(() => {
    latest.current = onSettled;
  });

  useEffect(() => {
    if (!canCapture || settled) return;
    const timer = setTimeout(() => latest.current(), durationMs);
    return () => clearTimeout(timer);
  }, [canCapture, settled, durationMs]);

  const state = settled && canCapture ? "full" : canCapture ? "filling" : "empty";
  const Icon = state === "full" ? Check : Hourglass;
  return (
    <div
      data-testid="ring"
      data-state={state}
      className="flex flex-col items-center justify-center gap-4 text-center"
    >
      <div className="relative size-60">
        <svg viewBox="0 0 120 120" aria-hidden className="size-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            strokeWidth="10"
            className="stroke-muted"
          />
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            className={cn(state === "empty" ? "stroke-transparent" : "stroke-live")}
            style={{
              strokeDasharray: LENGTH,
              strokeDashoffset: state === "empty" ? LENGTH : 0,
              // Fills slowly; empties at once.
              transition: state === "empty" ? "none" : `stroke-dashoffset ${durationMs}ms linear`,
              filter: "drop-shadow(0 0 0.5rem var(--live))",
            }}
          />
        </svg>
        <Icon
          aria-hidden
          className={cn(
            "absolute inset-0 m-auto size-24",
            state === "empty" ? "text-wait" : "text-live",
          )}
          strokeWidth={2}
        />
      </div>
      <p role="status" className="leading-tight font-bold">
        {text}
      </p>
    </div>
  );
}
