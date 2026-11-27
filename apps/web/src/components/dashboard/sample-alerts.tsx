"use client";

import { Bell } from "lucide-react";
import { useT } from "@/i18n/use-t";
import { SAMPLE_ALERTS } from "@/lib/sample-data";
import { AlertList } from "./alert-list";
import { Panel } from "./panel";
import { SampleTag } from "./sample-tag";

/** The "Recent alerts" card of the store officer's home. The bell links to it. */
export function SampleAlertsPanel() {
  const t = useT();
  return (
    <Panel id="alerts" icon={Bell} title={t("alerts.title")} tag={<SampleTag />}>
      <AlertList
        alerts={SAMPLE_ALERTS.map(({ id, kind, title, detail, values, time }) => ({
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
