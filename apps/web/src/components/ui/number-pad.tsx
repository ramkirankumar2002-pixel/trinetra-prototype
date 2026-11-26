"use client";

// Big digit keys, for PINs and phone numbers. A real keyboard works too, unless the
// person is typing in a text box.
import { cn } from "cn";
import { Delete, Eraser } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "./button";

export interface NumberPadProps {
  /** The digits typed so far. */
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  labels: { pad: string; clear: string; backspace: string };
  disabled?: boolean;
  className?: string;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const KEY = "min-h-16 text-2xl kiosk:min-h-24 kiosk:text-5xl";
const WORD_KEY = "min-h-16 flex-col gap-0 px-1 text-sm kiosk:flex-row kiosk:gap-2 kiosk:px-2";

export function NumberPad(props: NumberPadProps) {
  const { value, onChange, maxLength, labels, disabled, className } = props;
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const { value, onChange, maxLength, disabled } = latest.current;
      if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea")) return;
      if (/^\d$/.test(event.key)) {
        if (value.length < maxLength) onChange(value + event.key);
      } else if (event.key === "Backspace") {
        onChange(value.slice(0, -1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const full = value.length >= maxLength;
  const digit = (key: string) => (
    <Button
      key={key}
      variant="outline"
      className={KEY}
      disabled={disabled || full}
      onClick={() => onChange(value + key)}
    >
      {key}
    </Button>
  );

  return (
    <div
      role="group"
      aria-label={labels.pad}
      className={cn("grid w-full grid-cols-3 gap-2 kiosk:gap-3", className)}
    >
      {DIGITS.map(digit)}
      <Button
        variant="secondary"
        className={WORD_KEY}
        disabled={disabled || value === ""}
        onClick={() => onChange("")}
      >
        <Eraser aria-hidden />
        {labels.clear}
      </Button>
      {digit("0")}
      <Button
        variant="secondary"
        className={WORD_KEY}
        disabled={disabled || value === ""}
        onClick={() => onChange(value.slice(0, -1))}
      >
        <Delete aria-hidden />
        {labels.backspace}
      </Button>
    </div>
  );
}
