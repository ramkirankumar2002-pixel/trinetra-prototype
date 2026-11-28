"use client";

// For staff (behind the logo hold): each board, whether it is online, and when it was last
// heard. A driver never needs this.
import { DEVICE_IDS, formatIST } from "@trinetra/shared";
import { useT } from "@/i18n/use-t";
import { useBridge } from "@/lib/kiosk/bridge";
import { StatusLight } from "../ui/status-light";

export function DeviceList() {
  const t = useT();
  const devices = useBridge((state) => state.devices);
  const lastSeen = useBridge((state) => state.lastSeen);
  return (
    <ul className="flex flex-col gap-3">
      {DEVICE_IDS.map((id) => {
        const online = devices?.[id] ?? false;
        const seen = lastSeen?.[id];
        return (
          <li key={id} data-testid={`staff-device-${id}`} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-4">
              <span className="font-bold">{t(`settings.device.${id}`)}</span>
              <StatusLight
                tone={online ? "go" : "stop"}
                label={t(online ? "settings.online" : "settings.offline")}
              />
            </div>
            <span className="text-muted-foreground">
              {seen
                ? t("settings.lastSeen", { time: formatIST(new Date(seen)) })
                : t("settings.neverSeen")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
