"use client";

// Screen 10: every answer, large. Tap any line to change it.
import { formatKg, formatPlate, type TicketView } from "@trinetra/shared";
import { cn } from "cn";
import {
  ArrowRight,
  Box,
  Building2,
  ClipboardCheck,
  FileText,
  Pencil,
  Phone,
  Truck,
  UserRound,
  Weight,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { useKiosk, type Step } from "@/lib/kiosk/flow";
import { Button } from "../../ui/button";
import { SURFACE } from "../../ui/card";
import { KioskFrame } from "../frame";
import { materialLabel } from "../material-look";

interface Line {
  icon: LucideIcon;
  label: MessageKey;
  value: string | null;
  /** What to say when the driver may leave it out, and did. */
  skipped?: MessageKey;
  /** The question that changes it. Without one, the line cannot be changed. */
  step?: Step;
}

export function CheckScreen({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const goTo = useKiosk((state) => state.goTo);
  const fix = useKiosk((state) => state.fix);
  const [editing, setEditing] = useState(false);
  const { invoice } = ticket;

  const lines: Line[] = [
    { icon: Truck, label: "slip.plate", value: formatPlate(ticket.plate) },
    {
      icon: Box,
      label: "slip.material",
      value: ticket.material && materialLabel(t, ticket.material),
      step: "material",
    },
    { icon: Building2, label: "slip.supplier", value: ticket.supplier, step: "supplier" },
    { icon: Truck, label: "slip.transporter", value: ticket.transporter, step: "transporter" },
    { icon: Phone, label: "slip.driverPhone", value: ticket.driverPhone, step: "phone" },
    {
      icon: UserRound,
      label: "slip.driverName",
      value: ticket.driverName,
      skipped: "kiosk.check.notGiven",
      step: "name",
    },
    {
      icon: FileText,
      label: "slip.invoiceNo",
      value: ticket.noInvoice ? t("slip.noInvoicePill") : invoice.number,
    },
    {
      icon: Weight,
      label: "slip.invoiceWeight",
      value: invoice.weightKg === null ? null : formatKg(invoice.weightKg),
    },
  ];
  // Without these the truck cannot be weighed.
  const missing = !ticket.material || !ticket.driverPhone;

  return (
    <KioskFrame
      header={{
        icon: ClipboardCheck,
        title: t("kiosk.check.heading"),
        subtitle: t(editing ? "kiosk.check.tap" : "kiosk.check.ask"),
      }}
      actions={
        <>
          <Button variant="dark" aria-pressed={editing} onClick={() => setEditing(!editing)}>
            <Pencil aria-hidden />
            {t("kiosk.edit")}
          </Button>
          <Button disabled={missing} onClick={() => goTo("weigh1")}>
            {t("kiosk.next")}
            <ArrowRight aria-hidden />
          </Button>
        </>
      }
    >
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2">
        {lines.map(({ icon: Icon, label, value, skipped, step }) => {
          const content = (
            <>
              <span
                aria-hidden
                className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-primary-edge/35 bg-info-soft text-info-ink"
              >
                <Icon className="size-7" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="leading-tight text-muted-foreground">{t(label)}</span>
                <span className="leading-tight font-bold break-words">
                  {value ?? (skipped ? t(skipped) : "———")}
                </span>
              </span>
              {/* In the corner, so a long name keeps the whole width. */}
              {step && (
                <Pencil
                  aria-hidden
                  className={cn(
                    "absolute top-2 right-2 size-7",
                    editing ? "text-highlight" : "text-input",
                  )}
                />
              )}
            </>
          );
          const look = cn(
            SURFACE,
            "relative flex min-h-24 min-w-0 items-center gap-2 px-2 text-left",
          );
          return step ? (
            <button
              key={label}
              type="button"
              onClick={() => fix(step)}
              className={cn(
                look,
                "rounded-2xl outline-none focus-visible:ring-4 focus-visible:ring-ring",
                editing && "border-2 border-highlight shadow-primary",
              )}
            >
              {content}
            </button>
          ) : (
            <div key={label} data-fits className={cn(look, "rounded-2xl", editing && "opacity-60")}>
              {content}
            </div>
          );
        })}
      </div>
    </KioskFrame>
  );
}
