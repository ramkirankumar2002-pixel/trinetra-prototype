// What goes on the two slips (build plan section 12). The screen and the paper are built
// from this one list, so they cannot differ.
import { formatIST, formatKg, formatPlate, type SlipKind, type TicketView } from "@trinetra/shared";
import type { MessageKey, Translate } from "@/i18n/translate";
import { materialLabel } from "./material-look";

export type SlipName = Exclude<SlipKind, "REPRINT">;

export interface SlipField {
  /** The translation key of the label. */
  label: MessageKey;
  value: string;
  /** Takes the whole line. */
  wide?: boolean;
  /** On the screen it is in the heading or beside the QR code, not in the list. */
  printOnly?: boolean;
  emphasis?: "highlight" | "live";
}

/** "14:05", in India. */
export const timeIST = (at: string) => formatIST(new Date(at)).split(", ")[1]!.replace(" IST", "");

const DASH = "———";
const kg = (value: number | null) => (value === null ? DASH : formatKg(value));

const weighed = (value: number | null, at: string | null) =>
  value === null || at === null ? kg(value) : `${formatKg(value)} · ${timeIST(at)}`;

/** The store officer's decision on a weight that did not pass, if there was one. */
export const holdApproval = (ticket: TicketView) =>
  ticket.approvals.find((row) => row.kind === "HOLD" && row.status === "APPROVED");

/** Who approved this truck, and when: "Ram (Sr. Manager) · 14:02, 14:20". */
export function approvalsText(ticket: TicketView, t: Translate): string | null {
  const times = new Map<string, string[]>();
  for (const row of ticket.approvals) {
    const counts =
      row.status === "APPROVED" &&
      row.kind !== "DRIVER_HELP" &&
      row.plateWarningReason !== "FRONT_BACK_MISMATCH";
    if (!counts) continue;
    const manual = row.kind === "SUPERVISOR" && row.plateMatch !== true;
    const who = row.decidedBy ?? DASH;
    const when = row.decidedAt ? timeIST(row.decidedAt) : DASH;
    times.set(who, [
      ...(times.get(who) ?? []),
      manual ? `${when} (${t("slip.manualCheck")})` : when,
    ]);
  }
  const lines = [...times].map(([who, when]) => `${who} · ${when.join(", ")}`);
  return lines.length > 0 ? lines.join("; ") : null;
}

/** True once this slip has been printed: the next print is marked "Reprint". */
export const wasPrinted = (ticket: TicketView, slip: SlipName) =>
  ticket.timeline.some((entry) => entry.type === "SLIP_PRINTED" && entry.data.kind === slip);

export function slipFields(ticket: TicketView, slip: SlipName, t: Translate): SlipField[] {
  const material = ticket.material ? materialLabel(t, ticket.material) : DASH;
  const materialAndType = ticket.type ? `${material} · ${t(`slip.type.${ticket.type}`)}` : material;
  const approvals = approvalsText(ticket, t);
  const supervisor = ticket.supervisor?.name ?? DASH;
  const point = ticket.unloadingPoint?.code ?? DASH;
  const plate: SlipField = { label: "slip.plate", value: formatPlate(ticket.plate) };
  const approvedBy: SlipField[] = approvals
    ? [{ label: "slip.approvedBy", value: approvals, wide: true }]
    : [];

  if (ticket.load === "EMPTY") {
    return [
      { ...plate, wide: true },
      {
        label: "slip.emptyWeight",
        value: weighed(ticket.firstWeightKg, ticket.firstWeightAt),
        emphasis: "live",
        wide: true,
      },
    ];
  }

  /** In place of everything about a bill, for a truck that has none. */
  const withoutInvoice: SlipField = {
    label: "slip.invoice",
    value: t("slip.noInvoice"),
    wide: true,
  };
  const invoiceFields: SlipField[] = [
    { label: "slip.invoiceNo", value: ticket.invoice.number ?? DASH },
    { label: "slip.invoiceWeight", value: kg(ticket.invoice.weightKg) },
  ];

  if (slip === "FIRST") {
    return [
      plate,
      {
        label: "slip.firstWeight",
        value: weighed(ticket.firstWeightKg, ticket.firstWeightAt),
        emphasis: "live",
      },
      { label: "slip.material", value: materialAndType, wide: true },
      { label: "slip.supplier", value: ticket.supplier ?? DASH, wide: true },
      { label: "slip.transporter", value: ticket.transporter ?? DASH, wide: true },
      ...(ticket.noInvoice ? [withoutInvoice] : invoiceFields),
      { label: "slip.driverPhone", value: ticket.driverPhone ?? DASH },
      ...approvedBy,
      { label: "slip.goTo", value: point, printOnly: true },
      { label: "slip.supervisor", value: supervisor, printOnly: true },
      { label: "slip.supervisorPhone", value: ticket.supervisor?.phone ?? DASH, printOnly: true },
    ];
  }

  const hold = holdApproval(ticket);
  const accepted: SlipField = hold
    ? {
        label: hold.chosenWeight === "INVOICE_WEIGHT" ? "slip.acceptedInvoice" : "slip.acceptedNet",
        value: kg(ticket.finalWeightKg),
        emphasis: "highlight",
      }
    : { label: "slip.result", value: t("slip.pass"), emphasis: "live" };
  // Without an invoice there is nothing to pass; a store decision on the weights still shows.
  const checked: SlipField[] = ticket.noInvoice
    ? [withoutInvoice, ...(hold ? [accepted] : [])]
    : [
        { label: "slip.invoiceWeight", value: kg(ticket.invoice.weightKg) },
        {
          label: "slip.variance",
          value: ticket.variancePct === null ? DASH : `${ticket.variancePct}%`,
        },
        accepted,
      ];
  return [
    {
      label: "slip.firstShort",
      value: weighed(ticket.firstWeightKg, ticket.firstWeightAt),
    },
    {
      label: "slip.secondShort",
      value: weighed(ticket.secondWeightKg, ticket.secondWeightAt),
    },
    { label: "slip.netWeight", value: kg(ticket.netKg), emphasis: "live" },
    ...checked,
    plate,
    ...(ticket.noInvoice ? [] : [invoiceFields[0]!]),
    { label: "slip.material", value: materialAndType, wide: true },
    { label: "slip.supplier", value: ticket.supplier ?? DASH, wide: true },
    { label: "slip.transporter", value: ticket.transporter ?? DASH, wide: true },
    { label: "slip.unloadedAt", value: point, printOnly: true },
    { label: "slip.supervisor", value: supervisor, printOnly: true },
    ...approvedBy,
  ];
}
