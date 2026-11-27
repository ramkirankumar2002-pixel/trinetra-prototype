"use client";

// The supervisor's home: today's numbers and the truck to check next.
import { formatKg, supervisorDayStats, type SupervisorTicketView } from "@trinetra/shared";
import {
  CircleCheckBig,
  CircleX,
  Clock,
  Hourglass,
  ShieldCheck,
  Truck,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ConnectionStatusLight } from "@/components/connection-status";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Panel } from "@/components/dashboard/panel";
import { WelcomeBanner } from "@/components/dashboard/welcome-banner";
import { useCurrentUser } from "@/components/require-role";
import { WaitPill } from "@/components/wait-pill";
import { RoleShell } from "@/components/role-shell";
import { materialText, PlateText, WaitingPill } from "@/components/supervisor/parts";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n/use-t";
import { soundIsOn, subscribeSound } from "@/lib/supervisor/alerts";
import { useSupervisorTrucks } from "@/lib/supervisor/queries";

function NextTruck({ truck }: { truck: SupervisorTicketView }) {
  const t = useT();
  return (
    <div data-testid="next-truck" className="flex flex-col gap-3 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PlateText plate={truck.plate} />
          <WaitingPill truck={truck} />
          {truck.firstWeightAt && <WaitPill since={truck.firstWeightAt} />}
        </div>
        <p className="text-muted-foreground">
          {materialText(truck.material, t)} · {t("sup.trip", { trip: truck.tripNo ?? "—" })}
          {truck.invoiceWeightKg !== null && ` · ${formatKg(truck.invoiceWeightKg)}`}
        </p>
      </div>
      <Button asChild size="lg" className="min-h-16 text-xl md:min-w-56">
        <Link href={`/supervisor/verify/${truck.ticketId}`}>
          <ShieldCheck aria-hidden />
          {t("action.verify")}
        </Link>
      </Button>
    </div>
  );
}

function Home() {
  const t = useT();
  const user = useCurrentUser();
  const pending = useSupervisorTrucks("pending");
  const done = useSupervisorTrucks("done");
  const sound = useSyncExternalStore(subscribeSound, soundIsOn, () => false);
  const points = pending.data?.points ?? [];
  const stats =
    pending.data && done.data ? supervisorDayStats(pending.data.tickets, done.data.tickets) : null;
  const value = (number: number | undefined) => (number === undefined ? "—" : String(number));
  const next = pending.data?.tickets[0];
  const failed = pending.isError || done.isError;

  return (
    <>
      <WelcomeBanner
        greeting={t("banner.welcome")}
        name={user.name}
        detail={t("area.supervisor")}
        {...(points.length > 0
          ? {
              location: {
                label: t("banner.unloadingPoint"),
                value: points.map((point) => point.code).join(", "),
              },
            }
          : {})}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t("sup.connection")}</span>
        {/* The top bar has one too; this is the one the home page names. */}
        <ConnectionStatusLight testId="home-connection" />
      </div>
      {!sound && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Volume2 aria-hidden className="size-5 shrink-0" />
          {t("sup.tapForSound")}
        </p>
      )}

      <Panel icon={Truck} title={t("sup.nextTruck")}>
        {next ? (
          <NextTruck truck={next} />
        ) : pending.data ? (
          <EmptyState icon={Truck} title={t("sup.noTrucks")}>
            {t("empty.trucks")}
          </EmptyState>
        ) : failed ? null : (
          <Spinner label={t("sup.loading")} className="py-6" />
        )}
        {failed && (
          <div className="flex flex-col gap-2">
            <Banner tone="stop">{t("sup.loadFailed")}</Banner>
            <Button
              size="lg"
              variant="outline"
              onClick={() => void Promise.all([pending.refetch(), done.refetch()])}
            >
              {t("session.retry")}
            </Button>
          </div>
        )}
      </Panel>

      <section aria-label={t("sup.today")} className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KpiCard
          icon={Truck}
          colour="blue"
          value={value(stats?.coming)}
          label={t("sup.kpi.coming")}
          note={t("sup.kpi.comingNote")}
        />
        <KpiCard
          icon={Hourglass}
          colour="orange"
          value={value(stats?.waiting)}
          label={t("sup.kpi.waiting")}
        />
        <KpiCard
          icon={CircleCheckBig}
          colour="green"
          value={value(stats?.verified)}
          label={t("sup.verified")}
        />
        <KpiCard
          icon={CircleX}
          colour="purple"
          value={value(stats?.rejected)}
          label={t("status.rejected")}
        />
        <div className="col-span-2 xl:col-span-1 *:h-full">
          <KpiCard
            icon={Clock}
            colour="blue"
            value={
              stats?.averageWaitMin === null || stats === null
                ? "—"
                : t("kpi.minutes", { count: stats.averageWaitMin })
            }
            label={t("kpi.averageWait")}
          />
        </div>
      </section>
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
