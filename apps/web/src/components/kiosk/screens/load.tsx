"use client";

// After the plate, for a truck with no ticket waiting for a second weight: is it loaded or
// empty? An empty truck is weighed once, with no other question.
import type { TicketLoad, TicketView } from "@trinetra/shared";
import { createLucideIcon } from "lucide-react";
import { useT } from "@/i18n/use-t";
import { useKiosk } from "@/lib/kiosk/flow";
import { Banner } from "../../ui/banner";
import { ActionCard } from "../action-card";
import { KioskFrame } from "../frame";
import { useSaveDetails } from "./questions";

// A tipper truck, drawn twice: with a heap in its body, and with nothing in it. The two
// differ at a glance, also without the words.
const CAB_AND_WHEELS: [string, Record<string, string>][] = [
  ["path", { d: "M15 17V9h3.5a2 2 0 0 1 1.6.8l1.5 2a2 2 0 0 1 .4 1.2V17h-1.5", key: "cab" }],
  ["circle", { cx: "6.5", cy: "17.5", r: "2", key: "back" }],
  ["circle", { cx: "17.5", cy: "17.5", r: "2", key: "front" }],
  ["path", { d: "M8.5 17h7", key: "axle" }],
];

export const LoadedTruckIcon = createLucideIcon("loaded-truck", [
  ...CAB_AND_WHEELS,
  ["path", { d: "M4.5 17H2v-6h13", key: "body" }],
  ["path", { d: "M3 11c.5-2 2-2.5 3-2 .5-2.5 3.5-3 4.5-1 1.5-.8 3.2.5 3.2 3", key: "heap" }],
  ["path", { d: "M6.5 9.5v1.5M10.5 8v3", key: "stones" }],
]);

export const EmptyTruckIcon = createLucideIcon("empty-truck", [
  ...CAB_AND_WHEELS,
  ["path", { d: "M4.5 17H2v-6h13", key: "body" }],
]);

export function LoadScreen({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const goTo = useKiosk((state) => state.goTo);
  const { save, busy, problem } = useSaveDetails(ticket);

  async function choose(load: TicketLoad) {
    const saved = await save({ load });
    // Only if the kiosk is still on this question: the truck may have left meanwhile.
    if (saved && useKiosk.getState().step === "load") {
      goTo(load === "EMPTY" ? "weighEmpty" : "invoice");
    }
  }

  return (
    <KioskFrame
      header={{
        icon: LoadedTruckIcon,
        title: t("kiosk.load.heading"),
        subtitle: t("kiosk.load.ask"),
      }}
    >
      {problem && (
        <Banner tone="stop">
          <span role="alert">{t(problem)}</span>
        </Banner>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-6">
        <ActionCard
          icon={LoadedTruckIcon}
          title={t("kiosk.load.loaded")}
          description={t("kiosk.load.loadedText")}
          disabled={busy}
          onClick={() => void choose("LOADED")}
        />
        <ActionCard
          icon={EmptyTruckIcon}
          tone="teal"
          title={t("kiosk.load.empty")}
          description={t("kiosk.load.emptyText")}
          disabled={busy}
          onClick={() => void choose("EMPTY")}
        />
      </div>
    </KioskFrame>
  );
}
