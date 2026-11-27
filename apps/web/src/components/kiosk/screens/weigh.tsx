"use client";

// Screens 11 and 14, the two weighings. The weight on screen is only shown. When the
// driver confirms it, the kiosk sends no number: the backend takes the weight it has from
// the weighbridge at that moment.
import type { TicketView } from "@trinetra/shared";
import { ArrowRight, Pencil, Scale, TriangleAlert, Upload } from "lucide-react";
import { useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { useBridge } from "@/lib/kiosk/bridge";
import { kioskErrorKey } from "@/lib/kiosk/error-text";
import { sameDriver, useKiosk } from "@/lib/kiosk/flow";
import { usePutTicket } from "@/lib/kiosk/queries";
import { useAction } from "@/lib/kiosk/use-action";
import { useSocketStatus } from "@/lib/socket-hooks";
import { Banner } from "../../ui/banner";
import { Button } from "../../ui/button";
import { KioskFrame } from "../frame";
import { LiveWeight } from "../live-weight";
import { WeighingRing } from "../weighing";
import { uploadsOf } from "./invoice";

const INVOICE_NEEDED = new Set(["INVOICE_WEIGHT_REQUIRED", "INVOICE_WEIGHT_INVALID"]);

export function WeighScreen({ which, ticket }: { which: "first" | "second"; ticket: TicketView }) {
  const t = useT();
  const connected = useSocketStatus() === "connected";
  const reading = useBridge((state) => state.reading);
  const online = useBridge((state) => state.devices?.main ?? true);
  const goTo = useKiosk((state) => state.goTo);
  const fix = useKiosk((state) => state.fix);
  const uploadAgain = useKiosk((state) => state.uploadAgain);
  const putTicket = usePutTicket();
  const { busy, run } = useAction();

  const canCapture = connected && reading !== null && reading.canCapture;
  const [filled, setFilled] = useState(false);
  // How many weights the driver has refused: each weighing after one is a new press.
  const [attempt, setAttempt] = useState(0);
  const [problem, setProblem] = useState<{ code: string; key: MessageKey } | null>(null);
  // The moment the weight cannot be taken, the ring starts again.
  if (filled && !canCapture) setFilled(false);
  const settled = filled && canCapture;

  const waiting: MessageKey = !connected
    ? "connection.offline"
    : !online
      ? "kiosk.weigh.offline"
      : canCapture
        ? "kiosk.weigh.stayStill"
        : reading?.reason
          ? kioskErrorKey({ code: reading.reason })
          : "kiosk.weigh.waiting";

  async function confirm() {
    setProblem(null);
    const stillHere = sameDriver();
    const answer = await run(`weigh:${ticket.id}:${which}:${attempt}`, (key) =>
      api.post<TicketView>(`/api/tickets/${ticket.id}/${which}-weight`, { idempotencyKey: key }),
    );
    if (!answer || !stillHere()) return;
    if (answer.ok) {
      if (which === "first") goTo("result1");
      await putTicket(answer.data);
      return;
    }
    const { code } = answer.error;
    setProblem({ code, key: kioskErrorKey(answer.error) });
    if (code === "DETAILS_REQUIRED") fix("material");
    // Weigh from the start, unless the answer may only have been lost.
    if (!answer.error.retryable) setFilled(false);
  }

  async function weighAgain() {
    setProblem(null);
    const answer = await run(`discard:${ticket.id}:${which}:${attempt}`, (key) =>
      api.post<TicketView>(`/api/tickets/${ticket.id}/discard-weight`, { idempotencyKey: key }),
    );
    if (!answer) return;
    if (!answer.ok) {
      setProblem({ code: answer.error.code, key: kioskErrorKey(answer.error) });
      return;
    }
    setAttempt(attempt + 1);
    setFilled(false);
  }

  const invoiceNeeded = problem !== null && INVOICE_NEEDED.has(problem.code);
  // The heading already says "Please stay still" or asks if the weight is right. Under
  // the ring only something else is said: why no weight can be taken.
  const ringText = settled || waiting === "kiosk.weigh.stayStill" ? "" : t(waiting);

  return (
    <KioskFrame
      header={{
        icon: Scale,
        title: t(which === "first" ? "kiosk.weigh.first" : "kiosk.weigh.second"),
        subtitle: t(settled ? "kiosk.weigh.isCorrect" : "kiosk.weigh.stayStill"),
      }}
      actions={
        invoiceNeeded ? (
          <Button
            onClick={() => {
              uploadAgain(uploadsOf(ticket));
              goTo("invoice");
            }}
          >
            <Upload aria-hidden />
            {t("kiosk.invoice.upload")}
          </Button>
        ) : settled ? (
          <>
            <Button variant="danger" disabled={busy} onClick={() => void weighAgain()}>
              <TriangleAlert aria-hidden />
              {t("kiosk.weigh.wrong")}
            </Button>
            {which === "first" && (
              <Button variant="dark" disabled={busy} onClick={() => goTo("check")}>
                <Pencil aria-hidden />
                {t("kiosk.edit")}
              </Button>
            )}
            <Button disabled={busy} onClick={() => void confirm()}>
              {t("kiosk.next")}
              <ArrowRight aria-hidden />
            </Button>
          </>
        ) : undefined
      }
    >
      {problem && (
        <Banner tone="stop">
          <span role="alert">{t(problem.key)}</span>
        </Banner>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-4">
        <LiveWeight
          kg={connected && reading ? reading.kg : null}
          label={t("kiosk.liveWeight")}
          status={
            canCapture
              ? { tone: "go", label: t("kiosk.weigh.stable") }
              : { tone: "wait", label: t("kiosk.weigh.notStable") }
          }
        />
        <WeighingRing
          canCapture={canCapture}
          settled={settled}
          onSettled={() => setFilled(true)}
          text={ringText}
        />
      </div>
    </KioskFrame>
  );
}
