"use client";

// My trucks: those waiting for this supervisor, the longest wait first. It updates by
// itself (TruckWatcher).
import { formatKg } from "@trinetra/shared";
import { ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useT } from "@/i18n/use-t";
import { minutesSince, useNow, useSupervisorTrucks } from "@/lib/supervisor/queries";
import { DataTable } from "../dashboard/data-table";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { Spinner } from "../ui/spinner";
import { materialText, PlateText, WaitingPill } from "./parts";

export function Trucks() {
  const t = useT();
  const now = useNow();
  const { data, isError, refetch } = useSupervisorTrucks("pending");

  return (
    <>
      {isError && (
        <div className="flex flex-col gap-2">
          <Banner tone="stop">{t("sup.loadFailed")}</Banner>
          <Button size="lg" variant="outline" onClick={() => void refetch()}>
            {t("session.retry")}
          </Button>
        </div>
      )}
      <Card>
        {!data ? (
          !isError && <Spinner label={t("sup.loading")} className="py-10" />
        ) : data.tickets.length === 0 ? (
          <EmptyState icon={Truck} title={t("sup.noTrucks")}>
            {t("empty.trucks")}
          </EmptyState>
        ) : (
          <DataTable
            label={t("menu.trucks")}
            rows={data.tickets}
            rowKey={(truck) => truck.approvalId}
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
              { id: "trip", header: t("sup.column.trip"), cell: (truck) => truck.tripNo ?? "—" },
              {
                id: "invoice",
                header: t("slip.invoiceWeight"),
                nowrap: true,
                cell: (truck) =>
                  truck.invoiceWeightKg === null ? "—" : formatKg(truck.invoiceWeightKg),
              },
              {
                id: "waiting",
                header: t("sup.column.since"),
                cell: (truck) => {
                  const minutes = minutesSince(truck.firstWeightAt, now);
                  return minutes === null ? "—" : t("kpi.minutes", { count: minutes });
                },
              },
              {
                id: "status",
                header: t("column.status"),
                cell: (truck) => <WaitingPill truck={truck} />,
              },
              {
                id: "action",
                header: t("column.action"),
                actions: true,
                cell: (truck) => (
                  <Button asChild size="lg">
                    <Link href={`/supervisor/verify/${truck.ticketId}`}>
                      <ShieldCheck aria-hidden />
                      {t("action.verify")}
                    </Link>
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
