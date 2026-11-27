"use client";

// Trucks on site, today's history, and one ticket to read.
import {
  formatKg,
  waitsForPerson,
  type StoreTicketDecision,
  type StoreTicketView,
} from "@trinetra/shared";
import { ArrowRight, CircleCheckBig, Search, Truck } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useT } from "@/i18n/use-t";
import { ApiError } from "@/lib/api";
import {
  cancellationOf,
  decisionWords,
  kindPill,
  reasonWords,
  signed,
  truckPlace,
  visitHasEnded,
} from "@/lib/store/logic";
import { useStoreHistory, useStoreTicket, useTrucksOnSite } from "@/lib/store/queries";
import { DataTable } from "../dashboard/data-table";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Card, CardTitle } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { StatusPill } from "../ui/status-pill";
import { materialText, PlateText } from "../supervisor/parts";
import { WaitPill } from "../wait-pill";
import { CancelVisit } from "./cancel-visit";
import { BackLink, LoadFailed, Loading, PageState, TicketStatusPill, timeOf } from "./parts";
import { FIELD } from "./reason-form";
import { BillCard, PhotosCard, TimelineCard, TruckCard, WeightsCard } from "./ticket-panels";

function ViewButton({ href, plate }: { href: string; plate: string }) {
  const t = useT();
  return (
    <Button asChild size="lg" variant="outline">
      <Link href={href}>
        {t("action.view")}
        <ArrowRight aria-hidden />
        <span className="sr-only">{plate}</span>
      </Link>
    </Button>
  );
}

export function TrucksOnSite() {
  const t = useT();
  const { data, isError, refetch } = useTrucksOnSite();
  return (
    <>
      {isError && <LoadFailed onRetry={() => void refetch()} />}
      <Card>
        {!data ? (
          !isError && <Loading />
        ) : data.tickets.length === 0 ? (
          <EmptyState icon={Truck} title={t("store.noTrucks")}>
            {t("store.noTrucks.text")}
          </EmptyState>
        ) : (
          <DataTable
            label={t("menu.onSite")}
            rows={data.tickets}
            rowKey={(truck) => truck.ticketId}
            columns={[
              {
                id: "vehicle",
                header: t("column.vehicle"),
                nowrap: true,
                cell: (truck) => <PlateText plate={truck.plate} size="small" />,
              },
              {
                id: "material",
                header: t("column.material"),
                cell: (truck) => materialText(truck.material, t),
              },
              {
                id: "status",
                header: t("column.status"),
                cell: (truck) => <TicketStatusPill status={truck.status} />,
              },
              {
                id: "where",
                header: t("store.column.where"),
                cell: (truck) => {
                  const place = truckPlace(truck);
                  return <span data-testid="where">{t(place.key, place.params)}</span>;
                },
              },
              {
                id: "waiting",
                header: t("column.waiting"),
                nowrap: true,
                cell: (truck) =>
                  truck.waitingSince ? <WaitPill since={truck.waitingSince} /> : "—",
              },
              {
                id: "since",
                header: t("store.column.since"),
                nowrap: true,
                cell: (truck) => timeOf(truck.createdAt),
              },
              {
                id: "action",
                header: t("column.action"),
                actions: true,
                cell: (truck) => (
                  <>
                    {truck.pendingStoreApprovalId !== null && (
                      <Button asChild size="lg">
                        <Link href={`/store/approvals/${truck.pendingStoreApprovalId}`}>
                          {t("store.decide")}
                        </Link>
                      </Button>
                    )}
                    <ViewButton href={`/store/trucks/${truck.ticketId}`} plate={truck.plate} />
                  </>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}

/** "Approved by supervisor: Vikram Sharma, 00:00", with the choice and the reason. */
function DecisionLine({ decision }: { decision: StoreTicketDecision }) {
  const t = useT();
  const { about, result } = decisionWords(decision);
  const details = [
    decision.chosenWeight &&
      t(decision.chosenWeight === "MEASURED_NET" ? "slip.acceptedNet" : "slip.acceptedInvoice"),
    decision.reason && reasonWords(decision.reason, t),
  ].filter(Boolean);
  return (
    <span className="block">
      <strong>
        {about ? `${t(about)} · ` : ""}
        {t(result)}:
      </strong>{" "}
      {decision.decidedBy ?? "—"}, {timeOf(decision.decidedAt)}
      {details.length > 0 && (
        <span className="block text-muted-foreground">{details.join(" · ")}</span>
      )}
    </span>
  );
}

/** "Cancelled by Ram, 14:05", with the reason. */
function CancelLine({ cancelled }: { cancelled: NonNullable<StoreTicketView["cancelled"]> }) {
  const t = useT();
  return (
    <span data-testid="cancelled" className="block">
      <strong>{t("store.cancelledBy", { name: cancelled.by, time: timeOf(cancelled.at) })}</strong>
      <span className="block text-muted-foreground">{reasonWords(cancelled.reason, t)}</span>
    </span>
  );
}

function Decisions({ truck }: { truck: StoreTicketView }) {
  const t = useT();
  const { decisions, cancelled } = truck;
  if (decisions.length === 0 && !cancelled) return <span>{t("store.noPerson")}</span>;
  return (
    <span data-testid="decisions" className="flex flex-col gap-1 text-left text-sm">
      {decisions.map((decision) => (
        <DecisionLine key={decision.approvalId} decision={decision} />
      ))}
      {cancelled && <CancelLine cancelled={cancelled} />}
    </span>
  );
}

export function History() {
  const t = useT();
  const [search, setSearch] = useState("");
  const wanted = useDeferredValue(search.trim());
  const { data, isError, refetch } = useStoreHistory(wanted);
  const kg = (value: number | null) => (value === null ? "—" : formatKg(value));

  return (
    <>
      <label className="flex flex-col gap-1 font-semibold">
        {t("store.search")}
        <span className="relative flex">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            className={`${FIELD} pl-11`}
            maxLength={40}
            value={search}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setSearch(event.target.value)}
          />
        </span>
      </label>
      {isError && <LoadFailed onRetry={() => void refetch()} />}
      <Card>
        {!data ? (
          !isError && <Loading />
        ) : data.tickets.length === 0 ? (
          <EmptyState icon={CircleCheckBig} title={t(wanted ? "store.noMatch" : "store.noHistory")}>
            {t(wanted ? "store.noMatch.text" : "store.noHistory.text")}
          </EmptyState>
        ) : (
          <DataTable
            label={t("menu.history")}
            rows={data.tickets}
            rowKey={(truck) => truck.ticketId}
            columns={[
              {
                id: "vehicle",
                header: t("column.vehicle"),
                cell: (truck) => (
                  <span className="flex flex-col items-end gap-1 @2xl:items-start">
                    <PlateText plate={truck.plate} size="small" />
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      {truck.ticketNo}
                    </span>
                  </span>
                ),
              },
              {
                id: "status",
                header: t("slip.result"),
                cell: (truck) => (
                  <span className="flex flex-col items-end gap-1 @2xl:items-start">
                    <TicketStatusPill status={truck.status} cancelled={!!truck.cancelled} />
                    <span className="text-xs text-muted-foreground">
                      {truck.closedAt && timeOf(truck.closedAt)}
                    </span>
                  </span>
                ),
              },
              {
                id: "net",
                header: t("slip.netWeight"),
                nowrap: true,
                cell: (truck) => kg(truck.netKg),
              },
              {
                id: "invoice",
                header: t("slip.invoiceWeight"),
                nowrap: true,
                cell: (truck) => kg(truck.invoiceWeightKg),
              },
              {
                id: "difference",
                header: t("store.calc.percent"),
                nowrap: true,
                cell: (truck) => {
                  const { netKg, invoiceWeightKg, variancePct } = truck;
                  if (variancePct === null || netKg === null || invoiceWeightKg === null) {
                    return "—";
                  }
                  return `${variancePct}% (${signed(netKg - invoiceWeightKg, formatKg)})`;
                },
              },
              {
                id: "who",
                header: t("store.column.who"),
                cell: (truck) => <Decisions truck={truck} />,
              },
              {
                id: "action",
                header: t("column.action"),
                actions: true,
                cell: (truck) => (
                  <ViewButton href={`/store/history/${truck.ticketId}`} plate={truck.plate} />
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}

/** Every request of this ticket, answered or not: who approved what. */
function TicketDecisions({ ticketId }: { ticketId: number }) {
  const t = useT();
  const { data: ticket } = useStoreTicket(ticketId);
  if (!ticket) return null;
  const decided = ticket.approvals.filter((row) => row.status !== "PENDING");
  const cancelled = cancellationOf(ticket);
  return (
    <Card data-testid="who">
      <CardTitle>{t("store.column.who")}</CardTitle>
      {cancelled && <CancelLine cancelled={cancelled} />}
      {decided.length === 0 && !cancelled ? (
        <p>{t("store.noPerson")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {decided.map((row) => (
            <DecisionLine
              key={row.id}
              decision={{
                approvalId: row.id,
                kind: row.kind,
                plateWarningReason: row.plateWarningReason,
                status: row.status === "APPROVED" ? "APPROVED" : "REJECTED",
                decidedBy: row.decidedBy,
                decidedAt: row.decidedAt!,
                reason: row.reason,
                chosenWeight: row.chosenWeight,
              }}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Read-only. A request still waiting is decided on its own page. */
export function TicketPage({ ticketId, from }: { ticketId: number; from: "trucks" | "history" }) {
  const t = useT();
  const { data: ticket, error, refetch } = useStoreTicket(ticketId);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<"cancelled" | "taken" | null>(null);
  const back = (
    <BackLink
      href={`/store/${from}`}
      label={from === "trucks" ? "store.backToTrucks" : "sup.backToDone"}
    />
  );
  if (!ticket) {
    const gone = error instanceof ApiError && !error.retryable;
    return (
      <PageState>
        {gone ? (
          <Banner tone="stop">{t("sup.error.noTruck")}</Banner>
        ) : error ? (
          <LoadFailed onRetry={() => void refetch()} />
        ) : (
          <Loading />
        )}
        {back}
      </PageState>
    );
  }
  const open = ticket.approvals.filter((row) => row.status === "PENDING");
  // A request that closed with its ticket cannot be decided any more.
  const waiting = open.find((row) => row.kind !== "SUPERVISOR" && !visitHasEnded(ticket, row));
  const mayCancel = waitsForPerson(ticket.status, open);
  const since = mayCancel
    ? open.find((row) => row.plateWarningReason !== "FRONT_BACK_MISMATCH")?.createdAt
    : undefined;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <TruckCard ticket={ticket} />
      {result && (
        <div data-testid="outcome" data-outcome={result}>
          <Banner tone={result === "cancelled" ? "go" : "info"}>
            <span role="status">
              {t(result === "cancelled" ? "store.done.cancelled" : "store.done.taken")}
            </span>
          </Banner>
        </div>
      )}
      {since && (
        <p className="flex items-center gap-2">
          {t("store.waitingForPerson")}
          <WaitPill since={since} />
        </p>
      )}
      {waiting && !cancelling && (
        <Button asChild size="lg">
          <Link href={`/store/approvals/${waiting.id}`}>
            <StatusPill tone={kindPill(waiting).tone}>{t(kindPill(waiting).key)}</StatusPill>
            {t("store.decide")}
          </Link>
        </Button>
      )}
      {mayCancel && !result && (
        <CancelVisit
          ticket={ticket}
          open={cancelling}
          onOpen={setCancelling}
          onDone={(done) => {
            setCancelling(false);
            setResult(done);
          }}
        />
      )}
      <WeightsCard ticket={ticket} />
      <TicketDecisions ticketId={ticketId} />
      <PhotosCard ticket={ticket} />
      <BillCard ticket={ticket} />
      <TimelineCard ticket={ticket} />
      {back}
    </div>
  );
}
