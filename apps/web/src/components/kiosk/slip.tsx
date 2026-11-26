"use client";

// A slip on the weighbridge screen, and the same slip on white paper. The paper one is
// outside the app, and the only thing the browser's print dialog gets (globals.css).
import { formatIST, formatPlate, type TicketView } from "@trinetra/shared";
import { cn } from "cn";
import QRCode from "qrcode";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { translate, type MessageKey, type Translate } from "@/i18n/translate";
import { useLanguage, useT } from "@/i18n/use-t";
import { SURFACE } from "../ui/card";
import { StatusPill } from "../ui/status-pill";
import { holdApproval, slipFields, type SlipName } from "./slip-fields";

/** The address the QR code on a slip opens: the ticket's timeline (Phase 14). */
export const timelinePath = (ticketNo: string) => `/t/${ticketNo}`;

/** A QR code as a picture. Empty until it has been drawn. */
export function useQrImage(text: string | null): string | null {
  const [drawn, setDrawn] = useState<{ text: string; image: string } | null>(null);
  useEffect(() => {
    if (text === null) return;
    let wanted = true;
    // Black on white with a quiet border, so any phone can read it.
    QRCode.toDataURL(text, { margin: 2, width: 640, errorCorrectionLevel: "M" })
      .then((image) => wanted && setDrawn({ text, image }))
      .catch((error: unknown) => console.error("could not draw a QR code", error));
    return () => {
      wanted = false;
    };
  }, [text]);
  return drawn && drawn.text === text ? drawn.image : null;
}

const useTimelineQr = (ticketNo: string) => {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  return useQrImage(origin ? `${origin}${timelinePath(ticketNo)}` : null);
};

const slipTime = (ticket: TicketView, slip: SlipName) => {
  const at = slip === "FIRST" ? ticket.firstWeightAt : ticket.secondWeightAt;
  return formatIST(new Date(at ?? ticket.createdAt));
};

/** "PASS", or who allowed a weight that did not match. */
const resultKey = (ticket: TicketView): MessageKey =>
  holdApproval(ticket) ? "slip.storeApproved" : "slip.pass";

export function SlipView({
  ticket,
  slip,
  reprint,
}: {
  ticket: TicketView;
  slip: SlipName;
  /** It has been printed before. */
  reprint: boolean;
}) {
  const t = useT();
  const qr = useTimelineQr(ticket.ticketNo);
  const fields = slipFields(ticket, slip, t).filter((field) => !field.printOnly);
  const name = t(slip === "FIRST" ? "slip.first" : "slip.final");
  return (
    <section data-testid="slip" aria-label={name} className="flex min-h-0 flex-col gap-3">
      <div className={cn(SURFACE, "flex shrink-0 items-center gap-5 px-3 py-1")}>
        {/* The picture is made here, in the browser: there is nothing for Next to optimise. */}
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={t("slip.qr")} className="size-26 shrink-0 rounded-lg" />
        ) : (
          <span className="size-26 shrink-0" />
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-semibold text-muted-foreground">{name}</p>
          <p className="font-extrabold">{ticket.ticketNo}</p>
          <p>{slipTime(ticket, slip)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {slip === "FINAL" && <StatusPill tone="go">{t(resultKey(ticket))}</StatusPill>}
          {reprint && <StatusPill tone="info">{t("slip.reprint")}</StatusPill>}
        </div>
      </div>
      <dl className={cn(SURFACE, "grid grid-cols-2 gap-x-8 px-4")}>
        {fields.map((field) => (
          <div
            key={field.label}
            className={cn(
              "flex min-w-0 items-baseline gap-3 border-b border-border py-0.5 leading-tight last:border-b-0",
              field.wide && "col-span-2",
            )}
          >
            <dt className="shrink-0 text-muted-foreground">{t(field.label)}</dt>
            <dd
              className={cn(
                "ml-auto min-w-0 text-right font-semibold break-words",
                field.emphasis === "highlight" && "text-highlight",
                field.emphasis === "live" && "text-live",
              )}
            >
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The paper's words: English, and the driver's language beside it. */
function usePaperWords(): Translate {
  const { language } = useLanguage();
  return (key, params) => {
    const english = translate("en", key, params);
    const theirs = translate(language, key, params);
    return theirs === english ? english : `${english} / ${theirs}`;
  };
}

/** The same slip for the printer: black on white, one column, for 80 mm paper or A4. */
export function PrintSlip({
  ticket,
  slip,
  reprint,
}: {
  ticket: TicketView;
  slip: SlipName;
  reprint: boolean;
}) {
  const words = usePaperWords();
  const t = useT();
  const qr = useTimelineQr(ticket.ticketNo);
  // The page's body exists only in the browser.
  const body = useSyncExternalStore(
    () => () => {},
    () => document.body,
    () => null,
  );
  if (!body) return null;
  return createPortal(
    <div className="print-slip" data-testid="print-slip">
      <h1>Trinetra Systems</h1>
      <h2>{words(slip === "FIRST" ? "slip.first" : "slip.final")}</h2>
      {reprint && <p className="print-slip-mark">{words("slip.reprint")}</p>}
      {ticket.isDemo && <p className="print-slip-mark">{words("slip.demo")}</p>}
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt={t("slip.qr")} />
      )}
      <p className="print-slip-number">{ticket.ticketNo}</p>
      <p>{slipTime(ticket, slip)}</p>
      <table>
        <tbody>
          <tr>
            <th>{words("slip.plate")}</th>
            <td>{formatPlate(ticket.plate)}</td>
          </tr>
          {slipFields(ticket, slip, t)
            .filter((field) => field.label !== "slip.plate")
            .map((field) => (
              <tr key={field.label}>
                <th>{words(field.label)}</th>
                <td>{field.value}</td>
              </tr>
            ))}
          {/* A pass is already in the "Result" line above. */}
          {slip === "FINAL" && holdApproval(ticket) && (
            <tr>
              <th>{words("slip.status")}</th>
              <td>{words(resultKey(ticket))}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>,
    body,
  );
}
