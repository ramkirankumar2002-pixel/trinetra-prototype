"use client";

// The row under the header of every weighbridge screen: where the driver is (step dots),
// the live weight, and the weighbridge light. The connection is named only when it is lost.
import { CAMERA_IDS, formatKg } from "@trinetra/shared";
import { cn } from "cn";
import { Scale } from "lucide-react";
import { useT } from "@/i18n/use-t";
import { useBridge } from "@/lib/kiosk/bridge";
import { useSocketStatus } from "@/lib/socket-hooks";
import { ConnectionStatusLight } from "../connection-status";
import { StatusLight } from "../ui/status-light";

export function StepDots({ current, total }: { current: number; total: number }) {
  const t = useT();
  return (
    <div
      role="img"
      aria-label={t("kiosk.step", { current, total })}
      data-testid="steps"
      data-current={current}
      data-total={total}
      className="mr-auto flex items-center gap-3 self-center"
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "rounded-full border-2 border-highlight",
            index + 1 === current
              ? "size-6 bg-highlight shadow-[0_0_0.75rem_var(--highlight)]"
              : "size-4",
            index + 1 < current && "bg-highlight/70",
          )}
        />
      ))}
    </div>
  );
}

export function LiveWeightChip() {
  const t = useT();
  const connected = useSocketStatus() === "connected";
  const reading = useBridge((state) => state.reading);
  return (
    <p
      data-testid="live-weight"
      className="inline-flex items-center gap-3 rounded-full border border-border bg-card py-0.5 pr-5 pl-4 leading-tight font-bold text-live tabular-nums"
    >
      <Scale aria-hidden className="size-9" />
      <span className="sr-only">{t("kiosk.liveWeight")}: </span>
      {connected && reading ? formatKg(reading.kg) : "——— kg"}
    </p>
  );
}

export function BridgeLight() {
  const t = useT();
  const connected = useSocketStatus() === "connected";
  const online = useBridge((state) => state.devices?.main ?? null);
  const faulty = useBridge((state) => state.fault !== null);
  // Without a connection the last news may be old, and the connection light says why.
  if (!connected) return null;
  return (
    <StatusLight
      data-testid="weighbridge"
      // A board that is there but reports tampering is not "online" to anyone's eye.
      tone={faulty ? "stop" : online === null ? "idle" : online ? "go" : "stop"}
      label={t(
        faulty
          ? "weighbridge.fault"
          : online === null
            ? "weighbridge.checking"
            : online
              ? "weighbridge.online"
              : "weighbridge.offline",
      )}
    />
  );
}

/** Both cameras in one light: "Cam 2/2". Any longer and the row wraps onto a second line. */
export function CameraLight() {
  const t = useT();
  const connected = useSocketStatus() === "connected";
  const devices = useBridge((state) => state.devices);
  if (!connected || !devices) return null;
  const online = CAMERA_IDS.filter((camera) => devices[camera]).length;
  return (
    <StatusLight
      data-testid="cameras"
      data-online={online}
      tone={online === CAMERA_IDS.length ? "go" : "stop"}
      label={t("kiosk.cameras", { online, total: CAMERA_IDS.length })}
    />
  );
}

export function KioskStatus({ dots }: { dots: { current: number; total: number } | null }) {
  const connected = useSocketStatus() === "connected";
  return (
    <>
      {dots && <StepDots {...dots} />}
      <LiveWeightChip />
      <BridgeLight />
      <CameraLight />
      {/* Always there for a screen reader; seen only when there is a problem. */}
      <span className={connected ? "sr-only" : "contents"}>
        <ConnectionStatusLight />
      </span>
    </>
  );
}
