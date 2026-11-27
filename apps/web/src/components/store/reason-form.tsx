"use client";

// Why: quick answers to tap, and room to type. Nothing can be confirmed without one.
import { ArrowLeft, Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { REASON_MAX, reasonOf, type ReasonChip } from "@/lib/store/logic";
import { Button } from "../ui/button";
import { Card, CardTitle } from "../ui/card";

export const FIELD =
  "min-h-12 w-full rounded-lg border border-input bg-field px-3 py-2 text-lg text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/60";

export function ReasonForm({
  title,
  chips,
  confirm,
  danger,
  busy,
  problem,
  onConfirm,
  onBack,
}: {
  /** What is about to be done, with its numbers. */
  title: string;
  chips: readonly ReasonChip[];
  confirm: MessageKey;
  danger: boolean;
  busy: boolean;
  problem: ReactNode;
  onConfirm: (reason: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [chip, setChip] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const reason = reasonOf(chip, typed);
  return (
    <Card data-testid="reason-form">
      <CardTitle>{title}</CardTitle>
      <p className="text-muted-foreground">{t("store.reason.why")}</p>
      <div
        role="group"
        aria-label={t("store.reason.why")}
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1"
      >
        {chips.map(({ value, key }) => (
          <Button
            key={value}
            size="lg"
            className="h-auto py-2"
            variant={chip === value ? "primary" : "outline"}
            aria-pressed={chip === value}
            disabled={busy}
            onClick={() => setChip(chip === value ? null : value)}
          >
            {chip === value && <Check aria-hidden />}
            {t(key)}
          </Button>
        ))}
      </div>
      <label className="flex flex-col gap-1 font-semibold">
        {t("store.reason.type")}
        <textarea
          className={FIELD}
          rows={2}
          // The chip and the typed words are saved as one reason.
          maxLength={REASON_MAX - 60}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      {problem}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Button size="lg" variant="outline" disabled={busy} onClick={onBack}>
          <ArrowLeft aria-hidden />
          {t("kiosk.back")}
        </Button>
        <Button
          size="lg"
          className="h-auto min-h-14 py-2"
          variant={danger ? "stop" : "go"}
          disabled={busy || reason === null}
          onClick={() => reason && onConfirm(reason)}
        >
          <Check aria-hidden />
          {t(confirm)}
        </Button>
      </div>
    </Card>
  );
}
