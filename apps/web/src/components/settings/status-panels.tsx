"use client";

// How much of the free reading services is used, and whether the boards are there.
import { DEVICE_IDS, formatIST, type DemoOverview, type UsageMeter } from "@trinetra/shared";
import { cn } from "cn";
import { Cpu, Gauge } from "lucide-react";
import { useT } from "@/i18n/use-t";
import { Panel } from "../dashboard/panel";
import { StatusLight } from "../ui/status-light";
import { StatusPill } from "../ui/status-pill";

function Meter({ name, meter, label }: { name: string; meter: UsageMeter; label: string }) {
  const t = useT();
  const words = t("settings.used", { used: meter.used, limit: meter.limit });
  return (
    <div data-testid={`meter-${name}`} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span className="font-bold">{words}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={meter.limit}
        aria-valuenow={Math.min(meter.used, meter.limit)}
        aria-valuetext={words}
        className="h-3 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", meter.warn ? "bg-wait" : "bg-primary")}
          style={{ width: `${Math.min(100, (meter.used / meter.limit) * 100)}%` }}
        />
      </div>
      <StatusPill tone={meter.warn ? "wait" : "go"} className="self-start">
        {t(meter.warn ? "settings.nearLimit" : "settings.withinLimit")}
      </StatusPill>
    </div>
  );
}

export function UsagePanel({ overview }: { overview: DemoOverview }) {
  const t = useT();
  return (
    <Panel icon={Gauge} title={t("settings.usage")}>
      <div className="flex flex-col gap-4">
        <Meter
          name="plate-recognizer"
          label={t("settings.plateRecognizer")}
          meter={overview.usage.plateRecognizer}
        />
        <Meter name="gemini" label={t("settings.gemini")} meter={overview.usage.gemini} />
        <p className="text-sm text-muted-foreground">{t("settings.usageNote")}</p>
      </div>
    </Panel>
  );
}

export function DevicesPanel({ overview }: { overview: DemoOverview }) {
  const t = useT();
  return (
    <Panel icon={Cpu} title={t("settings.devices")}>
      <ul className="flex flex-col">
        {DEVICE_IDS.map((id) => {
          const { online, lastSeenAt } = overview.devices[id];
          return (
            <li
              key={id}
              data-testid={`device-${id}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-2 last:border-b-0"
            >
              <div>
                <p className="font-semibold">{t(`settings.device.${id}`)}</p>
                <p className="text-sm text-muted-foreground">
                  {lastSeenAt
                    ? t("settings.lastSeen", { time: formatIST(new Date(lastSeenAt)) })
                    : t("settings.neverSeen")}
                </p>
              </div>
              <StatusLight
                tone={online ? "go" : "stop"}
                label={t(online ? "settings.online" : "settings.offline")}
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
