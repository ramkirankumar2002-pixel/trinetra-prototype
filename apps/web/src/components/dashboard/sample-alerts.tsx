"use client";

import { Bell } from "lucide-react";
import { useT } from "@/i18n/use-t";
import { SAMPLE_ALERTS } from "@/lib/sample-data";
import type { StaffArea } from "@/lib/menus";
import { AlertList } from "./alert-list";
import { Panel } from "./panel";
import { SampleTag } from "./sample-tag";

/** The "Recent alerts" card of both dashboard homes. The bell links to it. */
export function SampleAlertsPanel({ area }: { area: StaffArea }) {
  const t = useT();
  return (
    <Panel id="alerts" icon={Bell} title={t("alerts.title")} tag={<SampleTag />}>
      <AlertList
        alerts={SAMPLE_ALERTS[area].map(({ id, kind, title, detail, values, time }) => ({
          id,
          kind,
          title: t(title),
          detail: t(detail, values),
          time,
        }))}
      />
    </Panel>
  );
}
