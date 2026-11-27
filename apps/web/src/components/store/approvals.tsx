"use client";

// The live queue: every request waiting for the store officer, the longest wait first.
// It updates by itself (StoreWatcher).
import { formatKg, formatPlate, type StoreRequestView } from "@trinetra/shared";
import { ArrowRight, ClipboardList, Inbox } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/i18n/use-t";
import { FILTER_KEYS, matchesFilter, REQUEST_FILTERS, type RequestFilter } from "@/lib/store/logic";
import { useStorePending } from "@/lib/store/queries";
import { DataTable } from "../dashboard/data-table";
import { Panel } from "../dashboard/panel";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { materialText, PlateText } from "../supervisor/parts";
import { KindPill, LoadFailed, Loading, timeOf, WaitPill } from "./parts";

export function RequestTable({
  label,
  requests,
}: {
  label: string;
  requests: readonly StoreRequestView[];
}) {
  const t = useT();
  return (
    <DataTable
      label={label}
      rows={requests}
      rowKey={(row) => row.approval.id}
      columns={[
        {
          id: "kind",
          header: t("column.request"),
          cell: (row) => <KindPill approval={row.approval} />,
        },
        {
          id: "vehicle",
          header: t("column.vehicle"),
          nowrap: true,
          cell: (row) => (row.ticket ? <PlateText plate={row.ticket.plate} size="small" /> : "—"),
        },
        {
          id: "material",
          header: t("column.material"),
          cell: (row) => materialText(row.ticket?.material ?? null, t),
        },
        {
          id: "invoice",
          header: t("slip.invoiceWeight"),
          nowrap: true,
          cell: (row) => {
            const kg = row.ticket?.invoiceWeightKg ?? null;
            return kg === null ? "—" : formatKg(kg);
          },
        },
        {
          id: "waiting",
          header: t("column.waiting"),
          nowrap: true,
          cell: (row) => <WaitPill since={row.approval.createdAt} />,
        },
        {
          id: "action",
          header: t("column.action"),
          actions: true,
          cell: (row) => (
            <Button asChild size="lg">
              <Link href={`/store/approvals/${row.approval.id}`}>
                {t("store.open")}
                <ArrowRight aria-hidden />
                <span className="sr-only">{row.ticket ? formatPlate(row.ticket.plate) : ""}</span>
              </Link>
            </Button>
          ),
        },
      ]}
    />
  );
}

/** Warnings of the last 24 hours that need no decision, such as a repeated bill. */
function Warnings() {
  const t = useT();
  const { data } = useStorePending();
  if (!data || data.warnings.length === 0) return null;
  return (
    <Panel title={t("store.warnings")}>
      <ul className="flex flex-col divide-y divide-border">
        {data.warnings.map((warning) => (
          <li key={`${warning.ticketId}${warning.type}${warning.at}`} className="py-2">
            <p className="flex flex-wrap items-center gap-2">
              <PlateText plate={warning.plate} size="small" />
              <strong>{t(`store.warning.${warning.type}`)}</strong>
              <span className="text-sm text-muted-foreground">{timeOf(warning.at)}</span>
            </p>
            <p className="text-sm">{warning.message}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Kept while the officer opens a request and comes back. */
let chosenFilter: RequestFilter = "all";

export function Approvals() {
  const t = useT();
  const [filter, setFilter] = useState<RequestFilter>(chosenFilter);
  const { data, isError, refetch } = useStorePending();
  const oldestFirst = data
    ? [...data.requests].sort((a, b) => a.approval.createdAt.localeCompare(b.approval.createdAt))
    : [];
  const shown = oldestFirst.filter((row) => matchesFilter(filter, row.approval.kind));

  return (
    <>
      {isError && <LoadFailed onRetry={() => void refetch()} />}
      <div role="group" aria-label={t("store.filter.label")} className="flex flex-wrap gap-2">
        {REQUEST_FILTERS.map((value) => {
          const count = oldestFirst.filter((row) => matchesFilter(value, row.approval.kind)).length;
          return (
            <Button
              key={value}
              size="lg"
              className="px-4"
              variant={filter === value ? "primary" : "outline"}
              aria-pressed={filter === value}
              onClick={() => {
                chosenFilter = value;
                setFilter(value);
              }}
            >
              {t(FILTER_KEYS[value])} ({count})
            </Button>
          );
        })}
      </div>
      <Card>
        {!data ? (
          !isError && <Loading />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={filter === "all" ? Inbox : ClipboardList}
            title={t("store.nothingWaiting")}
          >
            {t(filter === "all" ? "store.nothingWaiting.text" : "store.nothingOfKind")}
          </EmptyState>
        ) : (
          <RequestTable label={t("menu.approvals")} requests={shown} />
        )}
      </Card>
      <Warnings />
    </>
  );
}
