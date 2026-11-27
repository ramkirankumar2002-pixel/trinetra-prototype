"use client";

// The store officer's dashboard home. Everything counted or listed is SAMPLE data until
// Phase 13.
import { Check, CircleX, ClipboardCheck, ClipboardList, Hourglass, Pause, X } from "lucide-react";
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
import { SAMPLE_REQUESTS } from "@/lib/sample-data";

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
        detail={t("area.store")}
        location={{ label: t("banner.place"), value: t("banner.storeOffice") }}
      />
      <Banner>{t("sample.notice")}</Banner>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={Hourglass} colour="orange" value="4" label={t("kpi.pending")} />
        <KpiCard
          icon={ClipboardCheck}
          colour="green"
          value="2"
          label={t("kpi.type2")}
          trend={{ direction: "up", text: t("kpi.moreThanYesterday", { count: 1 }) }}
        />
        <KpiCard icon={Pause} colour="blue" value="1" label={t("kpi.hold")} />
        <KpiCard icon={CircleX} colour="purple" value="0" label={t("kpi.rejected")} />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2.8fr)_minmax(0,1fr)]">
        <Panel
          icon={ClipboardList}
          title={t("table.requests")}
          tag={<SampleTag />}
          viewAll={{ href: "/store/requests", label: t("action.viewAll") }}
        >
          <DataTable
            label={t("table.requests")}
            rows={SAMPLE_REQUESTS}
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
                id: "request",
                header: t("column.request"),
                cell: (row) => (
                  <StatusPill tone={row.request.tone}>{t(row.request.label)}</StatusPill>
                ),
              },
              {
                id: "action",
                header: t("column.action"),
                actions: true,
                cell: () => (
                  <>
                    <Button size="sm" variant="go" onClick={sampleOnly}>
                      <Check aria-hidden />
                      {t("action.approve")}
                    </Button>
                    <Button size="sm" variant="danger" onClick={sampleOnly}>
                      <X aria-hidden />
                      {t("action.reject")}
                    </Button>
                  </>
                ),
              },
            ]}
          />
        </Panel>
        <SampleAlertsPanel />
      </div>
    </>
  );
}

export function StoreHome() {
  return (
    <RoleShell area="store">
      <Home />
    </RoleShell>
  );
}
