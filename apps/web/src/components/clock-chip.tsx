"use client";

// Today's date and the time now, in India (formatIST), whatever the device is set to.
import { formatIST } from "@trinetra/shared";
import { cn } from "cn";
import { CalendarDays } from "lucide-react";
import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;

function everySecond(onChange: () => void) {
  const timer = setInterval(onChange, 1000);
  return () => clearInterval(timer);
}

/** Changes once a minute, so the screen is only redrawn when the minute does. */
const thisMinute = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
/** The server does not know when the page will be looked at. */
const notYet = () => 0;

export function useNowIST(): { date: string; time: string } | null {
  const minute = useSyncExternalStore(everySecond, thisMinute, notYet);
  if (minute === 0) return null;
  const [date, time] = formatIST(new Date(minute)).split(", ");
  return { date: date!, time: time! };
}

export function ClockChip({ className }: { className?: string }) {
  const now = useNowIST();
  return (
    <div
      data-testid="clock"
      className={cn(
        "inline-flex items-center gap-3 text-sm whitespace-nowrap",
        "kiosk:gap-3 kiosk:rounded-2xl kiosk:border kiosk:border-card-border kiosk:bg-card kiosk:px-4 kiosk:py-3 kiosk:text-[2rem] kiosk:leading-none kiosk:shadow-card kiosk:backdrop-blur-md",
        className,
      )}
    >
      <CalendarDays aria-hidden className="size-6 shrink-0 kiosk:size-9 kiosk:text-highlight" />
      <span className="flex flex-col leading-tight kiosk:flex-row kiosk:items-center kiosk:gap-3">
        <span>{now?.date ?? "———"}</span>
        <span aria-hidden className="hidden h-8 w-px bg-input kiosk:block" />
        <span className="font-bold kiosk:font-semibold">{now?.time ?? "——:——"}</span>
      </span>
    </div>
  );
}
