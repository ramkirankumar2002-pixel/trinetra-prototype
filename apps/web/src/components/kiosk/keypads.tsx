"use client";

// The only keyboards a driver ever sees: the plate keypad (the last fallback when the
// cameras cannot read the plate) and the letter keypad for the optional name.
import { formatPlate, isValidIndianPlate } from "@trinetra/shared";
import { cn } from "cn";
import { Delete, Space } from "lucide-react";
import { Button } from "../ui/button";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "1234567890".split("");
export const PLATE_MAX = 11;
export const NAME_MAX = 30;

const KEY =
  "min-h-24 min-w-0 border-input bg-field px-0 text-foreground kiosk:px-0 kiosk:text-[2.5rem] kiosk:shadow-[inset_0_1px_0_rgb(160_210_255/12%),0_0_0.75rem_rgb(30_110_255/14%)]";

export interface KeypadLabels {
  pad: string;
  backspace: string;
}

function Typed({
  text,
  placeholder,
  label,
  onDelete,
  deleteLabel,
  disabled,
}: {
  text: string;
  placeholder: string;
  label: string;
  onDelete: () => void;
  deleteLabel: string;
  disabled?: boolean | undefined;
}) {
  return (
    <div className="flex shrink-0 gap-3">
      <output
        aria-label={label}
        className="flex min-h-24 flex-1 items-center justify-center rounded-2xl border-4 border-foreground/80 bg-field px-4 text-[3.5rem] leading-none font-extrabold tracking-widest whitespace-pre tabular-nums"
      >
        {text || <span className="text-muted-foreground">{placeholder}</span>}
      </output>
      <Button
        variant="dark"
        className="min-w-48"
        disabled={disabled || text === ""}
        onClick={onDelete}
      >
        <Delete aria-hidden />
        {deleteLabel}
      </Button>
    </div>
  );
}

export function PlateKeypad({
  value,
  onChange,
  labels,
  disabled,
}: {
  /** Letters and digits only, as the backend stores a plate. */
  value: string;
  onChange: (value: string) => void;
  labels: KeypadLabels & { typed: string };
  disabled?: boolean;
}) {
  const full = value.length >= PLATE_MAX;
  const shown = isValidIndianPlate(value) ? formatPlate(value) : value;
  return (
    <div className="flex flex-col gap-3">
      <Typed
        text={shown}
        placeholder="MH 12 AB 1234"
        label={labels.typed}
        deleteLabel={labels.backspace}
        disabled={disabled}
        onDelete={() => onChange(value.slice(0, -1))}
      />
      <div role="group" aria-label={labels.pad} className="grid grid-cols-12 gap-2">
        {[...DIGITS, ...LETTERS].map((key) => (
          <Button
            key={key}
            variant="outline"
            // Digits stand out from letters: O and 0 are easy to mix up.
            className={cn(KEY, /\d/.test(key) && "text-highlight")}
            disabled={disabled || full}
            onClick={() => onChange(value + key)}
          >
            {key}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function LetterKeypad({
  value,
  onChange,
  labels,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  labels: KeypadLabels & { typed: string; space: string; placeholder: string };
  disabled?: boolean;
}) {
  const full = value.length >= NAME_MAX;
  return (
    <div className="flex flex-col gap-3">
      <Typed
        text={value}
        placeholder={labels.placeholder}
        label={labels.typed}
        deleteLabel={labels.backspace}
        disabled={disabled}
        onDelete={() => onChange(value.slice(0, -1))}
      />
      <div role="group" aria-label={labels.pad} className="grid grid-cols-9 gap-2">
        {LETTERS.map((key) => (
          <Button
            key={key}
            variant="outline"
            className={KEY}
            disabled={disabled || full}
            // Names are written with a capital first letter in each word.
            onClick={() =>
              onChange(value + (value === "" || value.endsWith(" ") ? key : key.toLowerCase()))
            }
          >
            {key}
          </Button>
        ))}
        <Button
          variant="outline"
          aria-label={labels.space}
          className={cn(KEY, "col-span-1")}
          disabled={disabled || full || value === "" || value.endsWith(" ")}
          onClick={() => onChange(`${value} `)}
        >
          <Space aria-hidden />
        </Button>
      </div>
    </div>
  );
}
