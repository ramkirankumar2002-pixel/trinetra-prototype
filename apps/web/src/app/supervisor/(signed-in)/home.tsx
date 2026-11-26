"use client";

// The supervisor's dashboard home. Everything counted or listed is SAMPLE data until
// Phase 12.
import { CircleCheckBig, CircleX, Clock, Hourglass, ShieldCheck, Truck } from "lucide-react";
import { DataTable } from "@/components/dashboard/data-table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Panel } from "@/components/dashboard/panel";
import { SampleAlertsPanel } from "@/components/dashboard/sample-alerts";
import { SampleTag } from "@/components/dashboard/sample-tag";
import { WelcomeBanner } from "@/components/dashboard/welcome-banner";
import { useCurrentUser } from "@/components/require-role";
import { RoleShell } from "@/components/role-shell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/use-t";
import { SAMPLE_TRUCKS } from "@/lib/sample-data";

function Home() {
  const t = useT();
  const toast = useToast();
  const user = useCurrentUser();
  const sampleOnly = () => toast({ tone: "info", title: t("sample.nothingDone") });

  return (
    <>
      <WelcomeBanner
        greeting={t("banner.welcome")}
        name={user.name}
        detail={t("area.supervisor")}
        location={{
          label: t("banner.unloadingPoint"),
          value: "CH-009+800",
          tag: <SampleTag />,
        }}
      />
      <Banner>{t("sample.notice")}</Banner>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={Hourglass} colour="orange" value="3" label={t("kpi.waiting")} />
        <KpiCard
          icon={CircleCheckBig}
          colour="green"
          value="8"
          label={t("kpi.verified")}
          trend={{ direction: "up", text: t("kpi.moreThanYesterday", { count: 2 }) }}
          percent={73}
        />
        <KpiCard icon={CircleX} colour="purple" value="1" label={t("kpi.rejected")} />
        <KpiCard
          icon={Clock}
          colour="blue"
          value={t("kpi.minutes", { count: 12 })}
          label={t("kpi.averageWait")}
          trend={{ direction: "down", text: t("kpi.lessThanYesterday", { count: 3 }) }}
        />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2.8fr)_minmax(0,1fr)]">
        <Panel
          icon={Truck}
          title={t("table.trucksForMe")}
          tag={<SampleTag />}
          viewAll={{ href: "/supervisor/trucks", label: t("action.viewAll") }}
        >
          <DataTable
            label={t("table.trucksForMe")}
            rows={SAMPLE_TRUCKS}
            rowKey={(row) => row.ticket}
            columns={[
              { id: "ticket", header: t("column.ticket"), nowrap: true, cell: (row) => row.ticket },
              {
                id: "vehicle",
                header: t("column.vehicle"),
                nowrap: true,
                cell: (row) => row.plate,
              },
              { id: "material", header: t("column.material"), cell: (row) => row.material },
              {
                id: "waiting",
                header: t("column.waiting"),
                cell: (row) =>
                  row.waitingMin === null ? "—" : t("kpi.minutes", { count: row.waitingMin }),
              },
              {
                id: "status",
                header: t("column.status"),
                cell: (row) => (
                  <StatusPill tone={row.status.tone}>{t(row.status.label)}</StatusPill>
                ),
              },
              {
                id: "action",
                header: t("column.action"),
                actions: true,
                cell: (row) =>
                  row.toVerify ? (
                    <Button size="sm" onClick={sampleOnly}>
                      <ShieldCheck aria-hidden />
                      {t("action.verify")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={sampleOnly}>
                      {t("action.view")}
                    </Button>
                  ),
              },
            ]}
          />
        </Panel>
        <SampleAlertsPanel area="supervisor" />
      </div>
    </>
  );
}

export function SupervisorHome() {
  return (
    <RoleShell area="supervisor">
      <Home />
    </RoleShell>
  );
}
