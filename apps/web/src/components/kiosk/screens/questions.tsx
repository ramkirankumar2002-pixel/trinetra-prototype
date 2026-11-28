"use client";

// Screens 6 to 9: material, supplier, transporter, phone and name. One question each;
// every answer is saved as soon as it is given.
import {
  DRIVER_PHONE_PATTERN,
  type DetailsResponse,
  type TicketDetailsRequest,
  type TicketView,
} from "@trinetra/shared";
import { ArrowRight, Box, Building2, Phone, SkipForward, Truck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { kioskErrorKey } from "@/lib/kiosk/error-text";
import { useKiosk, type Step } from "@/lib/kiosk/flow";
import { useMaster, usePutTicket } from "@/lib/kiosk/queries";
import { useAction } from "@/lib/kiosk/use-action";
import { Banner } from "../../ui/banner";
import { Button } from "../../ui/button";
import { SURFACE } from "../../ui/card";
import { NumberPad } from "../../ui/number-pad";
import { Spinner } from "../../ui/spinner";
import { YesNo } from "../../ui/yes-no";
import { KioskFrame } from "../frame";
import { LetterKeypad } from "../keypads";
import { materialIcon, materialLabel } from "../material-look";
import { ChoiceTiles } from "../tiles";

export function useSaveDetails(ticket: TicketView) {
  const putTicket = usePutTicket();
  const { busy, run } = useAction();
  const [problem, setProblem] = useState<MessageKey | null>(null);

  async function save(details: TicketDetailsRequest): Promise<DetailsResponse | null> {
    setProblem(null);
    // The same wrong answer given again is a new press, so the timeline length is part of it.
    const name = `details:${ticket.id}:${ticket.timeline.length}:${JSON.stringify(details)}`;
    const answer = await run(name, (key) =>
      api.patch<DetailsResponse>(`/api/tickets/${ticket.id}/details`, {
        idempotencyKey: key,
        body: details,
      }),
    );
    if (!answer) return null;
    if (!answer.ok) {
      setProblem(kioskErrorKey(answer.error));
      return null;
    }
    await putTicket(answer.data.ticket);
    return answer.data;
  }

  return { save, busy, problem };
}

export function MaterialScreen({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const master = useMaster();
  const answered = useKiosk((state) => state.answered);
  const { save, busy, problem } = useSaveDetails(ticket);
  const [mismatch, setMismatch] = useState(false);
  // After 5 tries the store officer chose the material: it is not asked again.
  const storeChose = ticket.approvals.some(
    (row) => row.kind === "MISMATCH" && row.status === "APPROVED",
  );
  useEffect(() => {
    if (storeChose && ticket.material !== null) answered("material");
  }, [storeChose, ticket.material, answered]);

  async function pick(material: string) {
    const result = await save({ material });
    if (!result) return;
    setMismatch(!result.materialMatched);
    if (result.materialMatched) answered("material");
  }

  return (
    <KioskFrame
      header={{ icon: Box, title: t("kiosk.material.heading"), subtitle: t("kiosk.material.ask") }}
    >
      {master.data ? (
        <ChoiceTiles
          label={t("kiosk.material.heading")}
          selected={ticket.material}
          disabled={busy}
          onPick={(value) => void pick(value)}
          message={
            problem
              ? { tone: "stop", text: t(problem) }
              : mismatch
                ? { tone: "stop", text: t("kiosk.material.mismatch") }
                : null
          }
          choices={master.data.materials.map(({ name }) => ({
            value: name,
            label: materialLabel(t, name),
            icon: materialIcon(name),
          }))}
        />
      ) : (
        <Spinner className="flex-1" label={t("kiosk.loading")} />
      )}
    </KioskFrame>
  );
}

const PARTIES = {
  supplier: {
    icon: Building2,
    list: "suppliers",
    heading: "kiosk.supplier.heading",
    confirm: "kiosk.supplier.confirm",
    choose: "kiosk.supplier.choose",
  },
  transporter: {
    icon: Truck,
    list: "transporters",
    heading: "kiosk.transporter.heading",
    confirm: "kiosk.transporter.confirm",
    choose: "kiosk.transporter.choose",
  },
} as const;

/** Supplier and transporter: confirm what the invoice or vehicle list says, or pick. */
export function PartyScreen({
  field,
  ticket,
}: {
  field: keyof typeof PARTIES;
  ticket: TicketView;
}) {
  const t = useT();
  const master = useMaster();
  const answered = useKiosk((state) => state.answered);
  const fixing = useKiosk((state) => state.fixing);
  const { save, busy, problem } = useSaveDetails(ticket);
  const [saidNo, setSaidNo] = useState(false);
  const party = PARTIES[field];
  const value = ticket[field];
  // Someone changing an answer wants another one: the list at once.
  const choosing = value === null || saidNo || fixing;

  async function choose(name: string) {
    if (await save({ [field]: name })) answered(field as Step);
  }

  const header = {
    icon: party.icon,
    title: t(party.heading),
    subtitle: t(choosing ? party.choose : party.confirm),
  };

  if (choosing) {
    return (
      <KioskFrame header={header}>
        {master.data ? (
          <ChoiceTiles
            label={t(party.heading)}
            columns={2}
            selected={value}
            disabled={busy}
            onPick={(name) => void choose(name)}
            message={problem ? { tone: "stop", text: t(problem) } : null}
            choices={master.data[party.list].map((name) => ({
              value: name,
              label: name,
              icon: party.icon,
            }))}
          />
        ) : (
          <Spinner className="flex-1" label={t("kiosk.loading")} />
        )}
      </KioskFrame>
    );
  }

  return (
    <KioskFrame
      header={header}
      actions={
        <YesNo
          className="col-span-full"
          yesLabel={t("common.yes")}
          noLabel={t("common.no")}
          disabled={busy}
          onYes={() => void choose(value)}
          onNo={() => setSaidNo(true)}
        />
      }
    >
      {problem && (
        <Banner tone="stop">
          <span role="alert">{t(problem)}</span>
        </Banner>
      )}
      <div
        className={`${SURFACE} flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center`}
      >
        <party.icon aria-hidden className="size-32 text-highlight" strokeWidth={1.25} />
        <p data-testid="party" className="text-[3.5rem] leading-tight font-extrabold text-balance">
          {value}
        </p>
      </div>
    </KioskFrame>
  );
}

export function PhoneScreen({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const answered = useKiosk((state) => state.answered);
  const { save, busy, problem } = useSaveDetails(ticket);
  const [digits, setDigits] = useState(ticket.driverPhone ?? "");
  const valid = DRIVER_PHONE_PATTERN.test(digits);
  // Said as soon as it is clear: a mobile number starts with 6 to 9.
  const wrong = !valid && (digits.length === 10 || /^[0-5]/.test(digits));

  return (
    <KioskFrame
      header={{ icon: Phone, title: t("kiosk.phone.heading"), subtitle: t("kiosk.phone.ask") }}
      actions={
        <Button
          disabled={busy || !valid}
          onClick={() =>
            void save({ driverPhone: digits }).then((result) => result && answered("phone"))
          }
        >
          {t("kiosk.next")}
          <ArrowRight aria-hidden />
        </Button>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-2 items-center gap-8">
        <div className="flex flex-col items-center gap-5">
          <output
            aria-label={t("kiosk.phone.heading")}
            className="w-full rounded-2xl border-4 border-foreground/80 bg-field py-4 text-center text-[3.75rem] leading-tight font-extrabold tracking-wider tabular-nums"
          >
            {digits || "———"}
          </output>
          {(wrong || problem) && (
            <Banner tone="stop">
              <span role="alert">{t(problem ?? "kiosk.phone.invalid")}</span>
            </Banner>
          )}
        </div>
        <NumberPad
          value={digits}
          onChange={setDigits}
          maxLength={10}
          disabled={busy}
          labels={{
            pad: t("numberPad.label"),
            clear: t("numberPad.clear"),
            backspace: t("numberPad.delete"),
          }}
        />
      </div>
    </KioskFrame>
  );
}

export function NameScreen({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const answered = useKiosk((state) => state.answered);
  const { save, busy, problem } = useSaveDetails(ticket);
  const [name, setName] = useState(ticket.driverName ?? "");

  return (
    <KioskFrame
      header={{ icon: UserRound, title: t("kiosk.name.heading"), subtitle: t("kiosk.name.ask") }}
      actions={
        <>
          <Button variant="dark" disabled={busy} onClick={() => answered("name")}>
            <SkipForward aria-hidden />
            {t("kiosk.skip")}
          </Button>
          <Button
            disabled={busy || name.trim() === ""}
            onClick={() =>
              void save({ driverName: name.trim() }).then((result) => result && answered("name"))
            }
          >
            {t("kiosk.next")}
            <ArrowRight aria-hidden />
          </Button>
        </>
      }
    >
      {problem && (
        <Banner tone="stop">
          <span role="alert">{t(problem)}</span>
        </Banner>
      )}
      <LetterKeypad
        value={name}
        disabled={busy}
        onChange={setName}
        labels={{
          pad: t("kiosk.name.keypad"),
          typed: t("kiosk.name.heading"),
          space: t("kiosk.name.space"),
          backspace: t("numberPad.delete"),
          placeholder: t("kiosk.name.placeholder"),
        }}
      />
    </KioskFrame>
  );
}
