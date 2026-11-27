"use client";

// Done today: this supervisor's decisions, and one of them with both photos side by side.
import { formatIST, formatPlate, type TicketView } from "@trinetra/shared";
import { ArrowLeft, ChevronRight, CircleCheckBig } from "lucide-react";
import Link from "next/link";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { ApiError } from "@/lib/api";
import { useSupervisorTicket, useSupervisorTrucks } from "@/lib/supervisor/queries";
import { firstWeightFrontPhoto, photoById, supervisorCheck } from "@/lib/supervisor/verify";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Card, SURFACE } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { Spinner } from "../ui/spinner";
import { DecisionPill, materialText, PlateText, reasonText, RESULT_KEYS, ZoomPhoto } from "./parts";

/** "14:05" in India. */
const timeOf = (iso: string) => formatIST(new Date(iso)).split(", ")[1]!.replace(" IST", "");

export function DoneList() {
  const t = useT();
  const { data, isError, refetch } = useSupervisorTrucks("done");

  if (!data) {
    return (
      <Card>
        {isError ? (
          <>
            <Banner tone="stop">{t("sup.loadFailed")}</Banner>
            <Button size="lg" onClick={() => void refetch()}>
              {t("session.retry")}
            </Button>
          </>
        ) : (
          <Spinner label={t("sup.loading")} className="py-10" />
        )}
      </Card>
    );
  }
  if (data.tickets.length === 0) {
    return (
      <Card className="min-h-72">
        <EmptyState icon={CircleCheckBig} title={t("sup.noDone")}>
          {t("empty.done")}
        </EmptyState>
      </Card>
    );
  }
  return (
    <ul aria-label={t("menu.done")} className="grid gap-3 lg:grid-cols-2">
      {data.tickets.map((truck) => (
        <li key={truck.approvalId}>
          <Link
            href={`/supervisor/done/${truck.ticketId}`}
            className={`${SURFACE} flex min-h-24 items-center gap-3 p-3 outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/60`}
          >
            {truck.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a short-lived link
              <img
                src={truck.photoUrl}
                alt={t("sup.myPhoto")}
                className="h-18 w-24 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-18 w-24 shrink-0 items-center justify-center rounded-lg bg-muted text-center text-xs text-muted-foreground">
                {t("sup.noPhoto")}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <PlateText plate={truck.plate} size="small" />
              <span className="flex flex-wrap items-center gap-2">
                <DecisionPill status={truck.approvalStatus} />
                <span className="text-sm text-muted-foreground">
                  {truck.decidedAt && timeOf(truck.decidedAt)}
                </span>
              </span>
              <span className="text-sm text-muted-foreground">
                {materialText(truck.material, t)}
                {truck.matchResult && ` · ${t(RESULT_KEYS[truck.matchResult])}`}
              </span>
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Facts({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const check = supervisorCheck(ticket)!;
  const facts: [MessageKey, string | null][] = [
    ["sup.decidedAt", check.decidedAt && formatIST(new Date(check.decidedAt))],
    ["slip.result", check.matchResult && t(RESULT_KEYS[check.matchResult])],
    ["sup.photoReads", check.plateRead ? formatPlate(check.plateRead) : "—"],
    ["sup.typedPlate", check.manualPlate && formatPlate(check.manualPlate)],
    [
      "sup.confidence",
      check.plateConfidence === null ? null : `${Math.round(check.plateConfidence * 100)}%`,
    ],
    ["sup.reasonLabel", check.reason && reasonText(check.reason, t)],
    ["sup.cameraApp", check.captureSource === "fallback" ? t("common.yes") : null],
    ["column.material", materialText(ticket.material, t)],
    ["sup.column.trip", ticket.tripNo === null ? null : String(ticket.tripNo)],
    ["column.ticket", ticket.ticketNo],
  ];
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {facts.map(([label, value]) =>
        value ? (
          <div key={label} className="flex flex-col">
            <dt className="text-sm text-muted-foreground">{t(label)}</dt>
            <dd className="font-semibold break-words">{value}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

export function DoneDetail({ ticketId }: { ticketId: number }) {
  const t = useT();
  const { data: ticket, error } = useSupervisorTicket(ticketId);
  const check = ticket && supervisorCheck(ticket);
  const back = (
    <Button asChild size="lg" variant="outline">
      <Link href="/supervisor/done">
        <ArrowLeft aria-hidden />
        {t("sup.backToDone")}
      </Link>
    </Button>
  );

  if (!ticket || !check) {
    const refused = error instanceof ApiError && error.status === 403;
    return (
      <Card>
        {error ? (
          <Banner tone="stop">{t(refused ? "sup.error.notYours" : "sup.loadFailed")}</Banner>
        ) : (
          <Spinner label={t("sup.loading")} className="py-10" />
        )}
        {back}
      </Card>
    );
  }
  const photos: [MessageKey, string | undefined][] = [
    ["sup.kioskPhoto", firstWeightFrontPhoto(ticket)?.url],
    ["sup.myPhoto", photoById(ticket, check.photoId)?.url],
  ];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <PlateText plate={ticket.plate} />
          {check.status !== "PENDING" && <DecisionPill status={check.status} />}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {photos.map(([label, url]) => (
            <figure key={label} className="flex flex-col gap-1">
              <ZoomPhoto url={url} label={t(label)} className="aspect-4/3 w-full" />
              <figcaption className="text-center text-sm font-semibold">{t(label)}</figcaption>
            </figure>
          ))}
        </div>
        <Facts ticket={ticket} />
      </Card>
      {back}
    </div>
  );
}
