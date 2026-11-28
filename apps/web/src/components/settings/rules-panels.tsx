"use client";

// The seeded rules, to read only. They are changed in the seed file, never on a screen.
import { formatKg, type DemoMasterData } from "@trinetra/shared";
import { Boxes, MapPin, Route } from "lucide-react";
import type { Translate } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { DataTable } from "../dashboard/data-table";
import { Panel } from "../dashboard/panel";
import { materialText } from "../supervisor/parts";
import { Banner } from "../ui/banner";

function typeRule(t: Translate, { type, type2AboveKg }: DemoMasterData["materials"][number]) {
  if (type2AboveKg !== null) return t("settings.rule.threshold", { kg: formatKg(type2AboveKg) });
  return t(type === "TYPE_1" ? "settings.rule.type1" : "settings.rule.type3");
}

export function RulesPanels({ master }: { master: DemoMasterData }) {
  const t = useT();
  type Rule = DemoMasterData["unloadingRules"][number];
  const trips = (rule: Rule) =>
    rule.tripFrom === null ? t("settings.anyTrip") : `${rule.tripFrom}–${rule.tripTo}`;

  return (
    <section aria-label={t("settings.rules")} className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">{t("settings.rules")}</h2>
      <Banner tone="info">{t("settings.tolerance", { pct: master.tolerancePct })}</Banner>

      <Panel icon={Boxes} title={t("settings.materials")}>
        <DataTable
          label={t("settings.materials")}
          rows={master.materials}
          rowKey={(row) => row.name}
          columns={[
            { id: "name", header: t("slip.material"), cell: (row) => materialText(row.name, t) },
            { id: "rule", header: t("settings.typeRule"), cell: (row) => typeRule(t, row) },
          ]}
        />
      </Panel>

      <Panel icon={Route} title={t("settings.unloadingRules")}>
        <DataTable
          label={t("settings.unloadingRules")}
          rows={master.unloadingRules}
          rowKey={(row) => `${row.material}-${row.tripFrom}`}
          columns={[
            {
              id: "material",
              header: t("slip.material"),
              cell: (row) =>
                row.material ? materialText(row.material, t) : t("settings.everythingElse"),
            },
            { id: "trips", header: t("settings.trips"), cell: trips, nowrap: true },
            {
              id: "point",
              header: t("public.point"),
              cell: ({ point }) =>
                point.code === point.name ? point.name : `${point.code} · ${point.name}`,
            },
            { id: "supervisor", header: t("area.supervisor"), cell: (row) => row.supervisor },
          ]}
        />
      </Panel>

      <Panel icon={MapPin} title={t("settings.chainages")}>
        <DataTable
          label={t("settings.chainages")}
          rows={master.chainages}
          rowKey={(row) => row.code}
          columns={[
            { id: "code", header: t("settings.chainage"), cell: (row) => row.code, nowrap: true },
            { id: "location", header: t("settings.location"), cell: (row) => row.location },
            { id: "supervisor", header: t("area.supervisor"), cell: (row) => row.supervisor },
          ]}
        />
      </Panel>
    </section>
  );
}
