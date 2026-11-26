"use client";

// Screens 12 to 15: the two slips, and the second visit's "Welcome back".
import { formatKg, formatPlate, type TicketView } from "@trinetra/shared";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Building2,
  Check,
  Clock,
  MapPin,
  Printer,
  Receipt,
  RotateCcw,
  Truck,
  Weight,
} from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { useKiosk } from "@/lib/kiosk/flow";
import { useReturnAfter } from "@/lib/kiosk/idle";
import { useTicket, usePutTicket } from "@/lib/kiosk/queries";
import { useAction } from "@/lib/kiosk/use-action";
import { Banner } from "../../ui/banner";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { DetailGrid } from "../detail-grid";
import { KioskFrame } from "../frame";
import { materialLabel } from "../material-look";
import { PrintSlip, SlipView } from "../slip";
import { timeIST, wasPrinted, type SlipName } from "../slip-fields";

/** A finished screen goes back to Ready by itself after this long. */
export const BACK_TO_READY_MS = 15_000;
/** A slip opened from the Ready list stays a little longer. */
const COLLECTED_SLIP_MS = 60_000;

function usePrint(ticket: TicketView, slip: SlipName) {
  const { busy, run } = useAction();
  const putTicket = usePutTicket();
  const [failed, setFailed] = useState(false);
  const reprint = wasPrinted(ticket, slip);

  async function print() {
    setFailed(false);
    // The browser's own dialog. "Save as PDF" works without a printer.
    window.print();
    const answer = await run(`printed:${ticket.id}:${slip}:${ticket.timeline.length}`, (key) =>
      api.post(`/api/tickets/${ticket.id}/printed`, {
        idempotencyKey: key,
        body: { kind: reprint ? "REPRINT" : slip },
      }),
    );
    if (!answer) return;
    if (!answer.ok) {
      setFailed(true);
      return;
    }
    // So the next print is marked as a reprint.
    await putTicket(await api.get<TicketView>(`/api/tickets/${ticket.id}`));
  }

  return { print, busy, reprint, failed };
}

function slipHeader(ticket: TicketView, slip: SlipName, t: ReturnType<typeof useT>) {
  const point = ticket.unloadingPoint?.code ?? "———";
  const supervisor = [ticket.supervisor?.name, ticket.supervisor?.phone].filter(Boolean);
  return slip === "FIRST"
    ? {
        icon: MapPin,
        hero: true,
        title: t("kiosk.result.goTo", { point }),
        subtitle: supervisor.join(" · "),
      }
    : {
        icon: Check,
        hero: true,
        title: t("kiosk.result.thanks"),
        subtitle: [`${t("slip.unloadedAt")}: ${point}`, ticket.supervisor?.name]
          .filter(Boolean)
          .join(" · "),
      };
}

function SlipScreen({
  ticket,
  slip,
  back,
}: {
  ticket: TicketView;
  slip: SlipName;
  back: { label: string; onClick: () => void; icon: typeof Check };
}) {
  const t = useT();
  const { print, busy, reprint, failed } = usePrint(ticket, slip);
  const BackIcon = back.icon;
  return (
    <KioskFrame
      status={false}
      header={slipHeader(ticket, slip, t)}
      actions={
        <>
          <Button variant="dark" onClick={back.onClick}>
            <BackIcon aria-hidden />
            {back.label}
          </Button>
          <Button disabled={busy} onClick={() => void print()}>
            <Printer aria-hidden />
            {t("kiosk.result.print")}
          </Button>
        </>
      }
    >
      {failed && (
        <Banner tone="stop">
          <span role="alert">{t("kiosk.result.printFailed")}</span>
        </Banner>
      )}
      <SlipView ticket={ticket} slip={slip} reprint={reprint} />
      <PrintSlip ticket={ticket} slip={slip} reprint={reprint} />
    </KioskFrame>
  );
}

/** Screen 12 (first slip) and screen 15 (final slip): then back to Ready. */
export function ResultScreen({ ticket, slip }: { ticket: TicketView; slip: SlipName }) {
  const t = useT();
  const finish = useKiosk((state) => state.finish);
  useReturnAfter(BACK_TO_READY_MS, finish);
  return (
    <SlipScreen
      ticket={ticket}
      slip={slip}
      back={{ label: t("kiosk.done"), onClick: finish, icon: Check }}
    />
  );
}

/** A slip opened from the "Ready to collect" list. */
export function CollectScreen() {
  const t = useT();
  const collect = useKiosk((state) => state.collect)!;
  const close = useKiosk((state) => state.closeCollect);
  const ticket = useTicket(collect.ticketId);
  useReturnAfter(COLLECTED_SLIP_MS, close);

  if (!ticket.data) {
    return (
      <KioskFrame
        header={{ icon: Receipt, title: t("kiosk.heading.wait") }}
        actions={
          <>
            <Button variant="dark" onClick={close}>
              <ArrowLeft aria-hidden />
              {t("kiosk.back")}
            </Button>
            {ticket.isError && (
              <Button onClick={() => void ticket.refetch()}>
                <RotateCcw aria-hidden />
                {t("kiosk.tryAgain")}
              </Button>
            )}
          </>
        }
      >
        <Spinner className="flex-1 flex-col" label={t("kiosk.loading")} />
      </KioskFrame>
    );
  }
  return (
    <SlipScreen
      ticket={ticket.data}
      slip={collect.slip}
      back={{ label: t("kiosk.back"), onClick: close, icon: ArrowLeft }}
    />
  );
}

/** Screen 13: the truck is back. What happens depends on the ticket's status. */
export function WelcomeBackScreen({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const goTo = useKiosk((state) => state.goTo);
  const ready = ticket.status === "READY_FOR_SECOND";
  const approved = ticket.approvals.some(
    (row) => row.kind === "SUPERVISOR" && row.status === "APPROVED",
  );

  return (
    <KioskFrame
      header={{
        icon: Truck,
        title: t("kiosk.visit2.heading"),
        subtitle: formatPlate(ticket.plate),
      }}
      actions={
        ready ? (
          <Button onClick={() => goTo("weigh2")}>
            {t("kiosk.visit2.weigh")}
            <ArrowRight aria-hidden />
          </Button>
        ) : undefined
      }
    >
      <Banner tone={ready ? "go" : "wait"}>
        <span role="status">
          {t(
            !ready
              ? "kiosk.visit2.waiting"
              : approved
                ? "kiosk.visit2.approved"
                : "kiosk.visit2.ready",
          )}
        </span>
      </Banner>
      <DetailGrid
        items={[
          { icon: Receipt, label: t("slip.ticket"), value: ticket.ticketNo },
          {
            icon: Weight,
            label: t("slip.firstShort"),
            value: ticket.firstWeightKg === null ? null : formatKg(ticket.firstWeightKg),
            emphasis: "highlight",
          },
          {
            icon: Box,
            label: t("slip.material"),
            value: ticket.material && materialLabel(t, ticket.material),
          },
          {
            icon: Clock,
            label: t("slip.time"),
            value: ticket.firstWeightAt && `${timeIST(ticket.firstWeightAt)} IST`,
          },
          { icon: Building2, label: t("slip.supplier"), value: ticket.supplier },
          {
            icon: MapPin,
            label: t("slip.unloadedAt"),
            value: ticket.unloadingPoint?.code ?? null,
          },
        ]}
      />
    </KioskFrame>
  );
}
