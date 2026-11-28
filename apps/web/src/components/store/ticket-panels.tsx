"use client";

// Everything about one ticket, as cards: the truck, its photos, the bill and what was read
// from it, the weights, and the timeline. Used by a request's page and by the read-only
// ticket page.
import {
  formatDate,
  formatIST,
  formatKg,
  formatPlate,
  type TicketView,
  type TimelineEntry,
} from "@trinetra/shared";
import { ExternalLink, FileText, Scale } from "lucide-react";
import type { MessageKey, Translate } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import {
  cancellationOf,
  holdSum,
  invoiceAsRead,
  invoiceFile,
  isLanguageOnly,
  isPdf,
  latestPhoto,
  reasonWords,
  savedAnswers,
  signed,
  STATUS_KEYS,
} from "@/lib/store/logic";
import { isDemoReading } from "@/lib/supervisor/verify";
import { Banner } from "../ui/banner";
import { buttonVariants } from "../ui/button";
import { Card, CardTitle } from "../ui/card";
import { materialText, PlateText, ZoomPhoto } from "../supervisor/parts";
import { Facts, TicketStatusPill } from "./parts";

const kg = (value: number | null) => (value === null ? "—" : formatKg(value));
const at = (iso: string | null) => (iso === null ? null : formatIST(new Date(iso)));

export function TruckCard({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const point = ticket.unloadingPoint;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <PlateText plate={ticket.plate} />
        <TicketStatusPill status={ticket.status} cancelled={cancellationOf(ticket) !== null} />
        {ticket.isDemo && (
          <span className="rounded-md border border-border px-2 py-0.5 text-xs font-semibold">
            {t("slip.demo")}
          </span>
        )}
      </div>
      {ticket.warnings.map((warning) => (
        <Banner key={`${warning.type}${warning.at}`} tone="wait">
          <span role="alert">
            <strong>{t(`store.warning.${warning.type}`)}</strong> {warning.message}
          </span>
        </Banner>
      ))}
      <Facts
        facts={[
          ["column.ticket", ticket.ticketNo],
          ["column.material", ticket.material && materialText(ticket.material, t)],
          [
            "store.type",
            ticket.load === "EMPTY"
              ? t("store.load.empty")
              : ticket.type && t(`slip.type.${ticket.type}`),
          ],
          ["sup.column.trip", ticket.tripNo],
          ["slip.unloadedAt", point && [...new Set([point.code, point.name])].join(" · ")],
          ["slip.supervisor", ticket.supervisor?.name],
          ["slip.transporter", ticket.transporter],
          ["slip.driverName", ticket.driverName],
          ["slip.driverPhone", ticket.driverPhone],
        ]}
      />
    </Card>
  );
}

export function PhotosCard({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const supervisor = latestPhoto(ticket, "SUPERVISOR");
  const photos: [MessageKey, string | undefined][] = [
    ["store.photo.front", latestPhoto(ticket, "FRONT_PLATE")?.url],
    ["store.photo.back", latestPhoto(ticket, "BACK_PLATE")?.url],
  ];
  if (supervisor) photos.push(["store.photo.supervisor", supervisor.url]);
  return (
    <Card>
      <CardTitle>{t("store.photos")}</CardTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {photos.map(([label, url]) => (
          <figure key={label} className="flex flex-col gap-1">
            <ZoomPhoto url={url} label={t(label)} className="aspect-4/3 w-full" />
            <figcaption className="text-center text-sm font-semibold">{t(label)}</figcaption>
          </figure>
        ))}
      </div>
    </Card>
  );
}

/** The file itself. A phone's browser may not show a PDF inside a page: it can be opened. */
function BillPreview({ url }: { url: string }) {
  const t = useT();
  if (!isPdf(url)) {
    return <ZoomPhoto url={url} label={t("store.bill")} className="aspect-3/4 w-full" />;
  }
  return (
    <div className="flex flex-col gap-2">
      <object
        data={url}
        type="application/pdf"
        aria-label={t("store.bill")}
        className="hidden aspect-3/4 w-full rounded-xl border border-border bg-muted md:block"
      >
        <p className="p-4 text-muted-foreground">{t("store.bill.noPreview")}</p>
      </object>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ size: "lg", variant: "outline" })}
      >
        <ExternalLink aria-hidden />
        {t("store.bill.openPdf")}
      </a>
    </div>
  );
}

export function BillCard({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const file = invoiceFile(ticket);
  const read = invoiceAsRead(ticket);
  const { state } = ticket.invoice;
  const missing = <span className="font-normal text-muted-foreground">{t("store.notRead")}</span>;
  return (
    <Card>
      <CardTitle>{t("store.bill")}</CardTitle>
      {ticket.noInvoice && <Banner tone="wait">{t("slip.noInvoice")}</Banner>}
      {!file ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <FileText aria-hidden className="size-5" />
          {t("store.bill.none")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <BillPreview url={file.url} />
          <div data-testid="bill-fields" className="flex min-w-0 flex-col gap-3">
            {state === "reading" && <Banner tone="wait">{t("kiosk.invoice.reading")}</Banner>}
            {state === "failed" && <Banner tone="stop">{t("kiosk.invoice.couldNotRead")}</Banner>}
            {read && (
              <>
                <h3 className="font-bold">
                  {t(read.source === "demo" ? "store.bill.readDemo" : "store.bill.readBy")}
                </h3>
                <Facts
                  facts={[
                    ["slip.invoiceNo", read.invoiceNo ?? missing],
                    ["column.material", read.material ? materialText(read.material, t) : missing],
                    [
                      "slip.invoiceWeight",
                      read.weightKg === null ? missing : formatKg(read.weightKg),
                    ],
                    ["store.vendor", read.supplier ?? missing],
                    ["slip.invoiceDate", ticket.invoice.date && formatDate(ticket.invoice.date)],
                    ["store.bill.model", read.model],
                  ]}
                />
                {read.warnings.map((code) => (
                  <Banner key={code} tone="wait">
                    {t(`store.billWarning.${code}` as MessageKey)}
                  </Banner>
                ))}
                {/* The reader returns no figure, and none is made up. */}
                <p className="text-sm text-muted-foreground">{t("store.bill.noConfidence")}</p>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function WeightsCard({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const held = ticket.firstWeightKg === null && ticket.heldWeightKg !== null;
  const empty = ticket.load === "EMPTY";
  const firstLabel = empty ? "slip.emptyWeight" : "slip.firstWeight";
  return (
    <Card>
      <CardTitle>{t("store.weights")}</CardTitle>
      <Facts
        facts={[
          [
            held ? "store.weight.held" : firstLabel,
            kg(held ? ticket.heldWeightKg : ticket.firstWeightKg),
          ],
          ["store.weight.firstAt", at(ticket.firstWeightAt)],
          ["kiosk.weigh.second", ticket.secondWeightKg === null ? null : kg(ticket.secondWeightKg)],
          ["slip.netWeight", ticket.netKg === null ? null : kg(ticket.netKg)],
          ["slip.invoiceWeight", empty || ticket.noInvoice ? null : kg(ticket.invoice.weightKg)],
          ["slip.variance", ticket.variancePct === null ? null : `${ticket.variancePct}%`],
          [
            "store.weight.accepted",
            ticket.finalWeightKg === null ? null : kg(ticket.finalWeightKg),
          ],
        ]}
      />
    </Card>
  );
}

/** The HOLD calculation, line by line. Every figure is the backend's. */
export function HoldCalculation({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const sum = holdSum(ticket);
  const rows: { label: MessageKey; value: string; note?: string; strong?: boolean }[] = [
    { label: "slip.firstWeight", value: kg(sum.firstKg) },
    { label: "kiosk.weigh.second", value: kg(sum.secondKg) },
    {
      label: "slip.netWeight",
      value: kg(sum.netKg),
      note: t("store.calc.netHow"),
      strong: true,
    },
    { label: "slip.invoiceWeight", value: kg(sum.invoiceKg), strong: true },
    {
      label: "store.calc.difference",
      value: sum.differenceKg === null ? "—" : signed(sum.differenceKg, formatKg),
      note: t("store.calc.differenceHow"),
    },
    {
      label: "store.calc.percent",
      value: sum.variancePct === null ? "—" : `${sum.variancePct}%`,
      note: t("store.calc.percentHow"),
      strong: true,
    },
    { label: "store.calc.limit", value: sum.limitPct === null ? "—" : `${sum.limitPct}%` },
  ];
  const over = sum.variancePct !== null && sum.limitPct !== null && sum.variancePct > sum.limitPct;
  return (
    <Card data-testid="calculation">
      <CardTitle className="flex items-center gap-2">
        <Scale aria-hidden className="size-5" />
        {t("store.calc.title")}
      </CardTitle>
      <dl className="flex flex-col divide-y divide-border">
        {rows.map(({ label, value, note, strong }) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="min-w-0">
              {t(label)}
              {note && <span className="block text-xs text-muted-foreground">{note}</span>}
            </dt>
            <dd
              data-field={label}
              className={`text-right whitespace-nowrap tabular-nums ${strong ? "text-xl font-extrabold" : "font-semibold"}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <Banner tone="stop">
        {over
          ? t("store.calc.over", { variance: sum.variancePct!, limit: sum.limitPct! })
          : t(sum.invoiceKg === null ? "store.calc.noInvoice" : "store.calc.badWeights")}
      </Banner>
    </Card>
  );
}

// ---- The timeline ----

const eventName = (type: string, t: Translate) => {
  const key = `store.event.${type}` as MessageKey;
  const text = t(key);
  return text === key ? type : text;
};

/** The few details of an event that a reader wants beside its name. */
function eventDetail({ type, data }: TimelineEntry, ticket: TicketView, t: Translate): string {
  const parts: string[] = [];
  const add = (label: MessageKey, value: string) => parts.push(`${t(label)}: ${value}`);
  if (type === "DETAILS_SAVED") {
    return savedAnswers(data)
      .map(({ label, value, material }) => {
        if (value === null) return t(label);
        return `${t(label)}: ${material ? materialText(value, t) : value}`;
      })
      .join(" · ");
  }
  if (typeof data.kg === "number") parts.push(formatKg(data.kg));
  if (typeof data.netKg === "number") add("slip.netWeight", formatKg(data.netKg));
  if (typeof data.acceptedKg === "number") add("store.weight.accepted", formatKg(data.acceptedKg));
  if (typeof data.chosenMaterial === "string") {
    add("column.material", materialText(data.chosenMaterial, t));
  }
  if (typeof data.driverSaid === "string") {
    add("store.driverSaid", materialText(data.driverSaid, t));
  }
  if (typeof data.plateRead === "string") {
    // The photo was the supervisor's, and in demo mode nothing was read from it. The
    // approval's line has no photo id of its own: it means the newest photo.
    const photoId =
      data.photoId ??
      ticket.timeline.filter((entry) => entry.type === "SUPERVISOR_PHOTO").at(-1)?.data.photoId;
    add(
      isDemoReading(ticket, photoId) ? "store.read.demo" : "store.read.supervisor",
      formatPlate(data.plateRead),
    );
  }
  if (typeof data.unloadingPoint === "string") add("slip.unloadedAt", data.unloadingPoint);
  if (typeof data.reason === "string") add("sup.reasonLabel", reasonWords(data.reason, t));
  if (typeof data.note === "string") add("sup.reasonLabel", data.note);
  if (typeof data.message === "string") parts.push(data.message);
  if (typeof data.from === "string" && typeof data.to === "string" && data.from !== data.to) {
    const name = (status: string) =>
      Object.hasOwn(STATUS_KEYS, status)
        ? t(STATUS_KEYS[status as keyof typeof STATUS_KEYS])
        : status;
    parts.push(`${name(data.from)} → ${name(data.to)}`);
  }
  return parts.join(" · ");
}

export function TimelineCard({ ticket }: { ticket: TicketView }) {
  const t = useT();
  return (
    <Card>
      <CardTitle>{t("store.timeline")}</CardTitle>
      <ol data-testid="timeline" className="flex flex-col divide-y divide-border">
        {ticket.timeline.map((entry, index) => {
          const detail = eventDetail(entry, ticket, t);
          const title =
            entry.type === "DETAILS_SAVED" && isLanguageOnly(entry.data)
              ? t("store.event.languageOnly")
              : eventName(entry.type, t);
          return (
            <li key={`${entry.at}${index}`} data-event={entry.type} className="py-2">
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-muted-foreground">
                {formatIST(new Date(entry.at))} · {entry.actorName}
              </p>
              {detail && <p className="text-sm break-words">{detail}</p>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
