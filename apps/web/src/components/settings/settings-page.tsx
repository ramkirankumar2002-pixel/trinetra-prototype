"use client";

// /settings: the switches for the demonstration, how much of the free reading services is
// used, whether the boards are there, "Reset demo data", and the seeded rules.
import { RoleShell } from "../role-shell";
import { LoadFailed, Loading } from "../store/parts";
import { Card } from "../ui/card";
import { useDemoMasterData, useDemoOverview, useDemoSettings } from "@/lib/settings/queries";
import { DevicesPanel, UsagePanel } from "./status-panels";
import { ResetPanel } from "./reset-panel";
import { RulesPanels } from "./rules-panels";
import { SwitchesPanel } from "./switches-panel";

function Content() {
  const settings = useDemoSettings();
  const overview = useDemoOverview();
  const master = useDemoMasterData();

  const failed = [settings, overview, master].filter((query) => query.error && !query.data);
  if (failed.length > 0) {
    return (
      <Card>
        <LoadFailed onRetry={() => failed.forEach((query) => void query.refetch())} />
      </Card>
    );
  }
  if (!settings.data || !overview.data || !master.data) {
    return (
      <Card>
        <Loading />
      </Card>
    );
  }
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <SwitchesPanel settings={settings.data} master={master.data} />
        <div className="flex flex-col gap-4">
          <UsagePanel overview={overview.data} />
          <DevicesPanel overview={overview.data} />
          <ResetPanel />
        </div>
      </div>
      <RulesPanels master={master.data} />
    </>
  );
}

export function SettingsPage() {
  return (
    <RoleShell
      area="store"
      page={{ section: "/settings", title: "settings.title", subtitle: "settings.subtitle" }}
    >
      <Content />
    </RoleShell>
  );
}
