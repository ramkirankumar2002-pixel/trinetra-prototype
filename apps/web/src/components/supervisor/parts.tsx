"use client";

// Small parts the supervisor's pages share.
import {
  formatPlate,
  type ApprovalStatus,
  type PlateMatchResult,
  type SupervisorTicketView,
} from "@trinetra/shared";
import { cn } from "cn";
import { ImageOff, ZoomIn } from "lucide-react";
import type { MessageKey, Translate } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { materialLabel } from "../kiosk/material-look";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "../ui/dialog";
import { StatusPill } from "../ui/status-pill";
import type { Tone } from "../ui/tone";

/** A number plate in large black letters, as on a truck. */
export function PlateText({
  plate,
  size = "large",
  className,
}: {
  plate: string;
  size?: "large" | "small";
  className?: string;
}) {
  return (
    <span
      data-testid="plate"
      className={cn(
        "inline-block rounded-lg border-2 border-foreground bg-field font-extrabold tracking-wide whitespace-nowrap",
        size === "large" ? "px-4 py-1.5 text-3xl md:text-4xl" : "px-2 py-0.5 text-base",
        className,
      )}
    >
      {formatPlate(plate)}
    </span>
  );
}

/** A photo; a tap shows it large. */
export function ZoomPhoto({
  url,
  label,
  className,
}: {
  url: string | null | undefined;
  label: string;
  className?: string;
}) {
  const t = useT();
  if (!url) {
    return (
      <span
        className={cn(
          "flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border p-2 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        <ImageOff aria-hidden className="size-6" />
        {t("sup.noPhoto")}
      </span>
    );
  }
  return (
    <Dialog>
      <DialogTrigger
        className={cn(
          "relative block min-h-12 overflow-hidden rounded-xl border border-border bg-muted outline-none focus-visible:ring-4 focus-visible:ring-ring/60",
          className,
        )}
      >
        {/* A short-lived link from the backend: nothing for Next to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className="size-full object-cover" />
        <span
          aria-hidden
          className="absolute right-1 bottom-1 rounded-md bg-black/65 p-1 text-white"
        >
          <ZoomIn className="size-4" />
        </span>
        <span className="sr-only">{t("sup.enlarge")}</span>
      </DialogTrigger>
      <DialogContent title={label} className="w-[min(96vw,56rem)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className="max-h-[65dvh] w-full rounded-lg object-contain" />
        <DialogClose asChild>
          <Button size="lg">{t("common.ok")}</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export const RESULT_KEYS: Record<PlateMatchResult, MessageKey> = {
  MATCH: "sup.result.MATCH",
  CLOSE: "sup.result.CLOSE",
  NO_MATCH: "sup.result.NO_MATCH",
  NOT_READ: "sup.result.NOT_READ",
  MANUAL: "sup.result.MANUAL",
};

export const RESULT_TONES: Record<PlateMatchResult, Tone> = {
  MATCH: "go",
  CLOSE: "wait",
  NO_MATCH: "stop",
  NOT_READ: "stop",
  MANUAL: "info",
};

/** A waiting truck: not checked yet, or what its newest photo showed. */
export function WaitingPill({ truck }: { truck: SupervisorTicketView }) {
  const t = useT();
  if (!truck.matchResult) {
    return <StatusPill tone="wait">{t("status.waiting")}</StatusPill>;
  }
  return (
    <StatusPill tone={RESULT_TONES[truck.matchResult]}>
      {t(RESULT_KEYS[truck.matchResult])}
    </StatusPill>
  );
}

export function DecisionPill({ status }: { status: ApprovalStatus }) {
  const t = useT();
  const approved = status === "APPROVED";
  return (
    <StatusPill tone={approved ? "go" : "stop"}>
      {t(approved ? "sup.verified" : "status.rejected")}
    </StatusPill>
  );
}

// ---- Reasons for rejecting ----

/** Saved in English, whatever the supervisor's language, so everyone reads the same. */
export const REJECT_REASONS = [
  { value: "Wrong truck", key: "sup.reason.wrongTruck" },
  { value: "Plate covered/fake", key: "sup.reason.covered" },
  { value: "Material not unloaded", key: "sup.reason.notUnloaded" },
] as const satisfies readonly { value: string; key: MessageKey }[];

/** A saved reason in the reader's language. Typed words stay as they were typed. */
export function reasonText(reason: string, t: Translate): string {
  const known = REJECT_REASONS.find((item) => item.value === reason);
  return known ? t(known.key) : reason;
}

/** The material in the reader's language. */
export const materialText = (material: string | null, t: Translate) =>
  material ? materialLabel(t, material) : "—";
