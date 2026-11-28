"use client";

// Screen 5: the driver uploads the invoice from their own phone by scanning the QR code.
// The kiosk sees it arrive, waits while it is read, and shows what was read. A driver
// without an invoice says "No invoice": the store officer then has to approve the truck.
import { useQuery } from "@tanstack/react-query";
import { formatDate, formatKg, type TicketView, type UploadLinkResponse } from "@trinetra/shared";
import {
  ArrowRight,
  Box,
  Building2,
  CalendarDays,
  Camera,
  FileText,
  FileX,
  PhoneOff,
  RotateCcw,
  ScanLine,
  Send,
  TriangleAlert,
  Truck,
  Upload,
  Weight,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { sameDriver, useKiosk } from "@/lib/kiosk/flow";
import { Banner } from "../../ui/banner";
import { Button } from "../../ui/button";
import { SURFACE } from "../../ui/card";
import { Spinner } from "../../ui/spinner";
import { DetailGrid } from "../detail-grid";
import { callStoreOfficer, KioskFrame } from "../frame";
import { useSaveDetails } from "./questions";
import { materialLabel } from "../material-look";
import { useQrImage } from "../slip";

/** How many files have reached the backend for this ticket. */
export const uploadsOf = (ticket: TicketView) =>
  ticket.timeline.filter((entry) => entry.type === "INVOICE_RECEIVED").length;

const STEPS: { icon: LucideIcon; key: MessageKey }[] = [
  { icon: ScanLine, key: "kiosk.invoice.step1" },
  { icon: Camera, key: "kiosk.invoice.step2" },
  { icon: Send, key: "kiosk.invoice.step3" },
];

/** One link per QR code asked for; a new one when it runs out. */
function useUploadLink(ticketId: number) {
  const driver = useKiosk((state) => state.driver);
  const round = useKiosk((state) => state.qrRound);
  const uploadAgain = useKiosk((state) => state.uploadAgain);
  const qrAfter = useKiosk((state) => state.qrAfter);
  const link = useQuery({
    queryKey: ["upload-link", driver, ticketId, round],
    queryFn: () => api.post<UploadLinkResponse>(`/api/tickets/${ticketId}/upload-link`),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
    // Asking again is a new link; a press must do that, not a retry.
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const expiresAt = link.data?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(
      () => uploadAgain(qrAfter ?? -1),
      Math.max(0, new Date(expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, qrAfter, uploadAgain]);
  return link;
}

function QrPanel({ ticketId }: { ticketId: number }) {
  const t = useT();
  const link = useUploadLink(ticketId);
  const url = link.data?.url ?? null;
  const image = useQrImage(url);
  // eslint-disable-next-line @next/next/no-img-element -- drawn here, in the browser
  const picture = image && <img src={image} alt={t("kiosk.invoice.qr")} className="size-full" />;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-8">
      <div
        data-testid="upload-qr"
        data-url={url ?? undefined}
        className="flex aspect-square h-full max-h-104 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-foreground p-1 shadow-primary"
      >
        {link.isError ? (
          <Button variant="dark" onClick={() => void link.refetch()}>
            <RotateCcw aria-hidden />
            {t("kiosk.tryAgain")}
          </Button>
        ) : !picture ? (
          <Spinner label={t("kiosk.loading")} />
        ) : process.env.NODE_ENV === "production" ? (
          picture
        ) : (
          // While developing, a click opens the phone page, so no phone is needed.
          <a href={url!} target="_blank" rel="noreferrer" className="block size-full">
            {picture}
          </a>
        )}
      </div>
      <ol className="flex min-w-0 flex-1 flex-col gap-3">
        {STEPS.map(({ icon: Icon, key }, index) => (
          <li key={key} className={`${SURFACE} flex min-h-28 items-center gap-4 px-4 py-2`}>
            <span
              aria-hidden
              className="inline-flex size-20 shrink-0 items-center justify-center rounded-2xl border-2 border-primary-edge/60 bg-info-soft text-highlight"
            >
              <Icon className="size-12" strokeWidth={1.5} />
            </span>
            <span className="leading-tight font-bold">
              {index + 1}. {t(key)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** After "No phone?": nothing for the driver to do but wait. */
function WaitingForOfficer({ onFoundPhone }: { onFoundPhone: () => void }) {
  const t = useT();
  return (
    <div
      data-testid="no-phone"
      className={`${SURFACE} flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center`}
    >
      <PhoneOff aria-hidden className="size-24 text-highlight" strokeWidth={1.5} />
      <p role="alert" className="max-w-5xl text-[3rem] leading-tight font-extrabold text-balance">
        {t("kiosk.invoice.officerComing")}
      </p>
      <Spinner label={t("kiosk.invoice.waitingOfficer")} />
      <Button variant="outline" onClick={onFoundPhone}>
        <ScanLine aria-hidden />
        {t("kiosk.invoice.foundPhone")}
      </Button>
    </div>
  );
}

export function InvoiceScreen({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const qrAfter = useKiosk((state) => state.qrAfter);
  const uploadAgain = useKiosk((state) => state.uploadAgain);
  const answered = useKiosk((state) => state.answered);
  const noPhone = useKiosk((state) => state.noPhone);
  const setNoPhone = useKiosk((state) => state.setNoPhone);
  const [calling, setCalling] = useState(false);
  const [callFailed, setCallFailed] = useState(false);
  const { save, busy, problem } = useSaveDetails(ticket);
  const uploads = uploadsOf(ticket);
  const { state } = ticket.invoice;
  // The QR code: before any upload, and after "send another" until one arrives.
  const showQr = state === "none" || (qrAfter !== null && uploads <= qrAfter);
  const header = (subtitle: MessageKey) => ({
    icon: FileText,
    title: t("kiosk.invoice.heading"),
    subtitle: t(subtitle),
  });

  async function withoutInvoice() {
    // "answered" does nothing if the kiosk has left this question meanwhile.
    if (await save({ noInvoice: true })) answered("invoice");
  }
  const noInvoiceButton = (
    <Button variant="dark" disabled={busy} onClick={() => void withoutInvoice()}>
      <FileX aria-hidden />
      {t("kiosk.invoice.none")}
    </Button>
  );
  const problemBanner = problem && (
    <Banner tone="stop">
      <span role="alert">{t(problem)}</span>
    </Banner>
  );

  async function callForUpload() {
    setCalling(true);
    setCallFailed(false);
    const stillHere = sameDriver();
    try {
      await callStoreOfficer(ticket.id, true);
      if (stillHere()) setNoPhone(true);
    } catch {
      setCallFailed(true);
    }
    setCalling(false);
  }

  if (showQr && noPhone) {
    return (
      <KioskFrame header={header("kiosk.invoice.pleaseWait")}>
        <WaitingForOfficer onFoundPhone={() => setNoPhone(false)} />
      </KioskFrame>
    );
  }

  if (showQr) {
    return (
      <KioskFrame
        header={header("kiosk.invoice.scan")}
        actions={
          <>
            {noInvoiceButton}
            <Button variant="outline" disabled={calling} onClick={() => void callForUpload()}>
              <PhoneOff aria-hidden />
              {t("kiosk.invoice.noPhone")}
            </Button>
          </>
        }
      >
        {problemBanner}
        {callFailed && (
          <Banner tone="stop">
            <span role="alert">{t("kiosk.helpFailed")}</span>
          </Banner>
        )}
        <QrPanel ticketId={ticket.id} />
      </KioskFrame>
    );
  }

  if (state === "reading") {
    return (
      <KioskFrame header={header("kiosk.invoice.arrived")}>
        <div className={`${SURFACE} flex flex-1 flex-col items-center justify-center`}>
          <Spinner
            className="flex-col text-[3rem] font-bold text-foreground"
            label={t("kiosk.invoice.reading")}
          />
        </div>
      </KioskFrame>
    );
  }

  if (state === "failed") {
    return (
      <KioskFrame
        header={header("kiosk.invoice.failed")}
        actions={
          <>
            {noInvoiceButton}
            <Button onClick={() => uploadAgain(uploads)}>
              <Upload aria-hidden />
              {t("kiosk.invoice.again")}
            </Button>
          </>
        }
      >
        {problemBanner}
        <div
          className={`${SURFACE} flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center`}
        >
          <TriangleAlert aria-hidden className="size-32 text-wait" strokeWidth={1.5} />
          <p role="alert" className="text-[3rem] leading-tight font-extrabold text-balance">
            {t("kiosk.invoice.couldNotRead")}
          </p>
        </div>
      </KioskFrame>
    );
  }

  const { invoice } = ticket;
  const otherTruck = ticket.warnings.some((warning) => warning.type === "INVOICE_VEHICLE_MISMATCH");
  return (
    <KioskFrame
      header={header("kiosk.invoice.check")}
      actions={
        <>
          <Button variant="danger" onClick={() => uploadAgain(uploads)}>
            <RotateCcw aria-hidden />
            {t("kiosk.invoice.wrong")}
          </Button>
          <Button onClick={() => answered("invoice")}>
            {t("kiosk.next")}
            <ArrowRight aria-hidden />
          </Button>
        </>
      }
    >
      {otherTruck ? (
        <Banner tone="wait">
          <span role="alert">{t("kiosk.invoice.otherTruck")}</span>
        </Banner>
      ) : (
        <Banner tone="go">{t("kiosk.invoice.wasRead")}</Banner>
      )}
      <DetailGrid
        items={[
          { icon: FileText, label: t("slip.invoiceNo"), value: invoice.number },
          {
            icon: Weight,
            label: t("slip.invoiceWeight"),
            value: invoice.weightKg === null ? null : formatKg(invoice.weightKg),
            emphasis: "highlight",
          },
          {
            icon: Box,
            label: t("slip.material"),
            value: invoice.material && materialLabel(t, invoice.material),
          },
          {
            icon: CalendarDays,
            label: t("slip.invoiceDate"),
            value: invoice.date && formatDate(invoice.date),
          },
          { icon: Building2, label: t("slip.supplier"), value: ticket.supplier },
          { icon: Truck, label: t("slip.transporter"), value: ticket.transporter },
        ]}
      />
    </KioskFrame>
  );
}
