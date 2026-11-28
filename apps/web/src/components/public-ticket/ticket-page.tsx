"use client";

// The page behind a slip's QR code (/t/<token>): read-only, no login, made for a phone,
// and printable. While the visit goes on it asks the backend again every few seconds.
import { useQuery } from "@tanstack/react-query";
import {
  formatIST,
  formatKg,
  isClosedStatus,
  PUBLIC_TOKEN_PATTERN,
  type PublicStepName,
  type PublicTicketView,
  type PublicTimelineStep,
  type TicketStatus,
} from "@trinetra/shared";
import { cn } from "cn";
import {
  Ban,
  Check,
  FileText,
  Hourglass,
  Printer,
  ScanLine,
  Scale,
  SearchX,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api, ApiError } from "@/lib/api";
import { statusShown } from "@/lib/store/logic";
import { LanguageSwitch } from "../language-switch";
import { LogoMark } from "../layout/brand";
import { ThemeRoot } from "../layout/theme-root";
import { materialText, PlateText, reasonText } from "../supervisor/parts";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { Spinner } from "../ui/spinner";
import { StatusPill } from "../ui/status-pill";
import { TONE_SOLID, type Tone } from "../ui/tone";

export const REFRESH_MS = 5000;

const STATUS_WORDS: Record<TicketStatus, MessageKey> = {
  STARTED: "public.status.STARTED",
  MISMATCH_PENDING: "public.status.WAIT_STORE",
  STORE_PENDING: "public.status.WAIT_STORE",
  READY_FOR_UNLOAD: "public.status.UNLOADING",
  SUPERVISOR_PENDING: "public.status.WAIT_SUPERVISOR",
  READY_FOR_SECOND: "public.status.UNLOADING",
  HOLD_PENDING: "public.status.HOLD",
  COMPLETED: "public.status.COMPLETED",
  REJECTED: "public.status.REJECTED",
  BLOCKED: "public.status.REJECTED",
  ABANDONED: "public.status.ENDED",
};

const STEP_LOOK: Record<PublicStepName, { icon: LucideIcon; tone: Tone }> = {
  ARRIVED: { icon: Truck, tone: "info" },
  PLATE_READ: { icon: ScanLine, tone: "info" },
  BILL_READ: { icon: FileText, tone: "info" },
  FIRST_WEIGHT: { icon: Scale, tone: "info" },
  PLATE_ALLOWED: { icon: ShieldCheck, tone: "go" },
  MATERIAL_SET: { icon: ShieldCheck, tone: "go" },
  SUPERVISOR_APPROVED: { icon: ShieldCheck, tone: "go" },
  SUPERVISOR_REJECTED: { icon: Ban, tone: "stop" },
  STORE_APPROVED: { icon: ShieldCheck, tone: "go" },
  SECOND_WEIGHT: { icon: Scale, tone: "info" },
  ON_HOLD: { icon: Hourglass, tone: "wait" },
  HOLD_APPROVED: { icon: ShieldCheck, tone: "go" },
  STORE_REJECTED: { icon: Ban, tone: "stop" },
  COMPLETED: { icon: Check, tone: "go" },
  CANCELLED: { icon: Ban, tone: "stop" },
  ABANDONED: { icon: Ban, tone: "idle" },
};

const when = (iso: string) => formatIST(new Date(iso));

/** A wrong or old address, as opposed to a server that cannot be reached just now. */
const isMissing = (error: unknown) => error instanceof ApiError && error.status === 404;

function usePublicTicket(token: string) {
  const possible = PUBLIC_TOKEN_PATTERN.test(token);
  const query = useQuery({
    queryKey: ["public-ticket", token],
    queryFn: ({ signal }) => api.get<PublicTicketView>(`/api/public/tickets/${token}`, { signal }),
    enabled: possible,
    // Until the visit has ended, or the address turns out to lead nowhere.
    refetchInterval: ({ state }) =>
      isMissing(state.error) || (state.data && isClosedStatus(state.data.status))
        ? false
        : REFRESH_MS,
  });
  return { ...query, missing: !possible || isMissing(query.error) };
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0 print:py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-semibold break-words">{value}</dd>
    </div>
  );
}

function Summary({ ticket }: { ticket: PublicTicketView }) {
  const t = useT();
  const kg = (value: number | null) => (value === null ? null : formatKg(value));
  // The accepted weight is shown only where it is not simply the net weight.
  const accepted = ticket.finalWeightKg === ticket.netKg ? null : kg(ticket.finalWeightKg);
  return (
    <Card className="flex flex-col gap-3 p-4 print:border-0 print:p-0 print:shadow-none">
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm break-words text-muted-foreground">
          {t("public.ticketNo")}{" "}
          <strong className="whitespace-nowrap text-foreground">{ticket.ticketNo}</strong>
        </p>
        {/* A line of its own: on a phone the plate needs the whole width. */}
        <PlateText plate={ticket.plate} />
        <div className="flex w-full items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col items-start gap-2">
            <StatusPill
              tone={statusShown(ticket.status, false).tone}
              data-testid="ticket-status"
              className="whitespace-normal"
            >
              {t(STATUS_WORDS[ticket.status])}
            </StatusPill>
            {ticket.isDemo && <StatusPill tone="wait">{t("demo.badge")}</StatusPill>}
          </div>
          {ticket.frontPhoto && (
            <TruckPhoto key={ticket.frontPhoto.takenAt} {...ticket.frontPhoto} />
          )}
        </div>
      </div>

      <dl>
        <Row
          label={t("slip.material")}
          value={ticket.material && materialText(ticket.material, t)}
        />
        <Row label={t("public.type")} value={ticket.type && t(`public.type.${ticket.type}`)} />
        <Row label={t("slip.invoiceNo")} value={ticket.invoiceNo} />
        <Row label={t("public.invoiceWeight")} value={kg(ticket.invoiceWeightKg)} />
        <Row label={t("slip.firstWeight")} value={kg(ticket.firstWeightKg)} />
        <Row label={t("public.secondWeight")} value={kg(ticket.secondWeightKg)} />
        <Row label={t("slip.netWeight")} value={kg(ticket.netKg)} />
        <Row
          label={t("public.difference")}
          value={ticket.variancePct === null ? null : `${ticket.variancePct}%`}
        />
        <Row label={t("public.accepted")} value={accepted} />
        <Row label={t("public.point")} value={ticket.unloadingPoint?.name ?? null} />
      </dl>
    </Card>
  );
}

/**
 * The truck, small. Its link is signed again at every refresh; the first one is kept, so
 * the picture is not fetched again every few seconds.
 */
function TruckPhoto({ url }: { url: string }) {
  const t = useT();
  const [shown, setShown] = useState(url);
  return (
    // A short-lived link from the backend: nothing for Next to optimise.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={shown}
      alt={t("public.truckPhoto")}
      data-testid="truck-photo"
      // An old link that no longer opens is replaced by the newest.
      onError={() => setShown(url)}
      className="h-20 w-28 shrink-0 rounded-lg border border-border bg-muted object-cover"
    />
  );
}

function Step({ entry, last }: { entry: PublicTimelineStep; last: boolean }) {
  const t = useT();
  const { icon: Icon, tone } = STEP_LOOK[entry.step];
  const manual =
    entry.step === "PLATE_READ" ? "public.manual.plate" : ("public.manual.check" as const);
  return (
    <li className="relative flex break-inside-avoid gap-3 pb-4 last:pb-0 print:pb-1.5">
      {!last && (
        <span aria-hidden className="absolute top-8 bottom-0 left-4 w-0.5 bg-border print:hidden" />
      )}
      <span
        aria-hidden
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-full print:size-5",
          TONE_SOLID[tone],
        )}
      >
        <Icon className="size-4 print:size-3" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="leading-snug font-semibold">
          {t(`public.step.${entry.step}`)}
          {entry.kg !== null && <span> · {formatKg(entry.kg)}</span>}
        </p>
        <p className="text-sm text-muted-foreground">
          <time dateTime={entry.at}>{when(entry.at)}</time>
        </p>
        {entry.by && (
          <p className="text-sm">
            {entry.by.name} · {t(entry.by.role === "STORE" ? "area.store" : "area.supervisor")}
          </p>
        )}
        {entry.manual && <p className="text-sm text-muted-foreground">{t(manual)}</p>}
        {entry.reason && (
          <p className="text-sm break-words">
            {t("public.reason", { reason: reasonText(entry.reason, t) })}
          </p>
        )}
      </div>
    </li>
  );
}

function Ticket({ ticket, stale }: { ticket: PublicTicketView; stale: boolean }) {
  const t = useT();
  return (
    <>
      {stale && (
        <div className="print:hidden">
          <Banner tone="stop">
            <span role="alert">{t("public.unreachable")}</span>
          </Banner>
        </div>
      )}
      {!isClosedStatus(ticket.status) && (
        <div className="print:hidden">
          <Banner tone="info">{t("public.live")}</Banner>
        </div>
      )}
      <Summary ticket={ticket} />
      <Card className="flex flex-col gap-3 p-4 print:border-0 print:p-0 print:shadow-none">
        <h2 className="text-lg font-bold">{t("public.timeline")}</h2>
        <ol data-testid="public-timeline">
          {ticket.timeline.map((entry, index) => (
            <Step
              key={`${entry.step}-${entry.at}`}
              entry={entry}
              last={index === ticket.timeline.length - 1}
            />
          ))}
        </ol>
      </Card>
      <Button size="lg" className="print:hidden" onClick={() => window.print()}>
        <Printer aria-hidden />
        {t("public.print")}
      </Button>
    </>
  );
}

export function PublicTicketPage({ token }: { token: string }) {
  const t = useT();
  const { data, error, missing } = usePublicTicket(token);

  let content: ReactNode;
  if (missing) {
    content = (
      <Card className="min-h-72">
        <EmptyState icon={SearchX} title={t("public.notFound")}>
          {t("public.notFoundText")}
        </EmptyState>
      </Card>
    );
  } else if (data) {
    content = <Ticket ticket={data} stale={error !== null} />;
  } else {
    content = (
      <Card>
        <Spinner label={t(error ? "public.unreachable" : "public.loading")} className="py-12" />
      </Card>
    );
  }

  return (
    <ThemeRoot theme="dashboard" className="min-h-dvh text-base print:bg-white print:text-sm">
      <header className="bg-nav text-nav-foreground print:bg-transparent print:text-foreground">
        <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-between gap-2 px-4 py-2 print:px-0">
          <p className="flex items-center gap-2 font-extrabold uppercase">
            {/* The logo has a navy background of its own: not for white paper. */}
            <LogoMark className="w-16 print:hidden" />
            Trinetra Systems
          </p>
          <div className="w-52 print:hidden">
            <LanguageSwitch onNavy />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-col gap-3 p-4 print:gap-2 print:p-0">
        {content}
      </main>
    </ThemeRoot>
  );
}
