"use client";

// The store officer's home: today's real numbers, and the five requests that have waited
// longest.
import type { StoreRequestView, StoreSummaryResponse } from "@trinetra/shared";
import {
  Check,
  CircleCheckBig,
  ClipboardList,
  Hourglass,
  Inbox,
  Pause,
  Truck,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { useSocketStatus } from "@/lib/socket-hooks";
import { useStorePending, useStoreSummary } from "@/lib/store/queries";
import { soundIsOn, subscribeSound } from "@/lib/supervisor/alerts";
import { KpiCard, type KpiColour } from "../dashboard/kpi-card";
import { Panel } from "../dashboard/panel";
import { WelcomeBanner } from "../dashboard/welcome-banner";
import { useCurrentUser } from "../require-role";
import { Banner } from "../ui/banner";
import { EmptyState } from "../ui/empty-state";
import { LoadFailed, Loading } from "./parts";
import { RequestTable } from "./approvals";

const OLDEST_SHOWN = 5;

const NUMBERS: {
  id: keyof StoreSummaryResponse;
  icon: LucideIcon;
  colour: KpiColour;
  label: MessageKey;
  note: MessageKey;
}[] = [
  {
    id: "waiting",
    icon: Hourglass,
    colour: "orange",
    label: "store.kpi.waiting",
    note: "store.note.now",
  },
  {
    id: "approved",
    icon: Check,
    colour: "green",
    label: "store.kpi.approved",
    note: "store.note.today",
  },
  { id: "rejected", icon: X, colour: "purple", label: "status.rejected", note: "store.note.today" },
  { id: "onHold", icon: Pause, colour: "blue", label: "kpi.hold", note: "store.note.now" },
  { id: "onSite", icon: Truck, colour: "blue", label: "store.kpi.onSite", note: "store.note.now" },
  {
    id: "completed",
    icon: CircleCheckBig,
    colour: "green",
    label: "store.kpi.completed",
    note: "store.note.today",
  },
];

/** Whether new requests arrive by themselves right now. */
function LiveStatus() {
  const t = useT();
  const status = useSocketStatus();
  const connected = status === "connected";
  const down = status === "reconnecting" || status === "login-required";
  return (
    <div data-testid="live-status">
      <Banner tone={connected ? "go" : down ? "stop" : "wait"}>
        {t(connected ? "store.live.on" : down ? "store.live.off" : "connection.connecting")}
      </Banner>
    </div>
  );
}

/** The five that have waited longest, the longest first. */
export const oldestRequests = (requests: readonly StoreRequestView[]) =>
  [...requests]
    .sort((a, b) => a.approval.createdAt.localeCompare(b.approval.createdAt))
    .slice(0, OLDEST_SHOWN);

export function StoreHomeContent() {
  const t = useT();
  const user = useCurrentUser();
  const summary = useStoreSummary();
  const pending = useStorePending();
  const sound = useSyncExternalStore(subscribeSound, soundIsOn, () => true);

  return (
    <>
      <WelcomeBanner
        greeting={t("banner.welcome")}
        name={user.name}
        detail={t("area.store")}
        location={{ label: t("banner.place"), value: t("banner.storeOffice") }}
      />
      <LiveStatus />
      {!sound && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Volume2 aria-hidden className="size-4 shrink-0" />
          {t("store.tapForSound")}
        </p>
      )}
      {summary.isError && !summary.data && <LoadFailed onRetry={() => void summary.refetch()} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {NUMBERS.map(({ id, icon, colour, label, note }) => (
          <KpiCard
            key={id}
            icon={icon}
            colour={colour}
            value={summary.data ? String(summary.data[id]) : "—"}
            label={t(label)}
            note={t(note)}
          />
        ))}
      </div>
      <Panel
        icon={ClipboardList}
        title={t("store.oldest")}
        viewAll={{ href: "/store/approvals", label: t("action.viewAll") }}
      >
        {!pending.data ? (
          pending.isError ? (
            <LoadFailed onRetry={() => void pending.refetch()} />
          ) : (
            <Loading />
          )
        ) : pending.data.requests.length === 0 ? (
          <EmptyState icon={Inbox} title={t("store.nothingWaiting")}>
            {t("store.nothingWaiting.text")}
          </EmptyState>
        ) : (
          <RequestTable
            label={t("store.oldest")}
            requests={oldestRequests(pending.data.requests)}
          />
        )}
      </Panel>
    </>
  );
}
