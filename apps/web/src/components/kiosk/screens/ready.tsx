"use client";

// Screen 1, the waiting screen: can a truck drive on, whose slip is ready, and who has
// just been turned away.
import { formatPlate, type KioskReadyEvent } from "@trinetra/shared";
import { cn } from "cn";
import { Check, Hourglass, Printer, Truck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t";
import { useBridge } from "@/lib/kiosk/bridge";
import { useKiosk } from "@/lib/kiosk/flow";
import { useCollectLists } from "@/lib/kiosk/queries";
import { useSocketEvent } from "@/lib/socket-hooks";
import { Banner } from "../../ui/banner";
import { Button } from "../../ui/button";
import { SURFACE } from "../../ui/card";
import { TONE_GLOW, TONE_SOLID, type Tone } from "../../ui/tone";
import { KioskFrame } from "../frame";

/** More than these would not fit at 1366×768; the newest are shown. */
const SHOWN_READY = 3;
const SHOWN_NOT_APPROVED = 2;
const ANNOUNCE_MS = 20_000;

export function ReadyScreen() {
  const t = useT();
  const main = useBridge((state) => state.devices?.main ?? null);
  const busy = useBridge((state) => state.truckPresent);
  const openCollect = useKiosk((state) => state.openCollect);
  const lists = useCollectLists();
  const [announced, setAnnounced] = useState<KioskReadyEvent | null>(null);
  useSocketEvent("kiosk:ready", setAnnounced);
  useEffect(() => {
    if (!announced) return;
    const timer = setTimeout(() => setAnnounced(null), ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [announced]);

  const status: { tone: Tone; key: "ready" | "busy" | "offline" | "checking" } =
    main === null
      ? { tone: "wait", key: "checking" }
      : !main
        ? { tone: "stop", key: "offline" }
        : busy
          ? { tone: "stop", key: "busy" }
          : { tone: "go", key: "ready" };
  const Icon = { go: Check, stop: X, wait: Hourglass, info: Check, idle: Hourglass }[status.tone];

  const ready = lists.data?.ready ?? [];
  const notApproved = lists.data?.notApproved ?? [];

  return (
    <KioskFrame header={{ icon: Truck, title: t("area.kiosk") }}>
      {announced && (
        <Banner tone="go">
          <span role="alert">
            {t("kiosk.ready.announce", { plate: formatPlate(announced.plate) })}
          </span>
        </Banner>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <div
          data-testid="bridge-status"
          data-tone={status.tone}
          role="status"
          className={cn(SURFACE, "flex flex-col items-center justify-center gap-6 p-6 text-center")}
        >
          <span
            aria-hidden
            className={cn(
              "inline-flex size-56 items-center justify-center rounded-full",
              TONE_SOLID[status.tone],
              TONE_GLOW[status.tone],
            )}
          >
            <Icon className="size-32" strokeWidth={3} />
          </span>
          <p className="text-[2.5rem] leading-tight font-extrabold text-balance">
            {t(`kiosk.ready.${status.key}`)}
          </p>
        </div>

        <div className={cn(SURFACE, "flex min-h-0 flex-col gap-3 p-4")}>
          <h2 className="font-bold text-highlight">{t("kiosk.ready.collect")}</h2>
          {ready.length === 0 && (
            <p className="leading-tight text-muted-foreground">{t("kiosk.ready.none")}</p>
          )}
          {ready.slice(0, SHOWN_READY).map((entry) => (
            <Button
              key={entry.ticketId}
              variant="go"
              className="justify-between px-5 kiosk:px-5"
              onClick={() => openCollect({ ticketId: entry.ticketId, slip: entry.slip })}
            >
              <span className="font-extrabold">{formatPlate(entry.plate)}</span>
              <Printer aria-hidden />
            </Button>
          ))}
          {ready.length > SHOWN_READY && (
            <p className="leading-tight">
              {t("kiosk.ready.more", { count: ready.length - SHOWN_READY })}
            </p>
          )}
          {notApproved.length > 0 && (
            <div className="mt-auto flex flex-col gap-2 rounded-2xl border-2 border-stop-edge bg-stop-soft p-3 leading-tight text-stop-ink">
              <p className="flex items-center gap-3 font-bold">
                <X aria-hidden className="size-9 shrink-0" strokeWidth={4} />
                {t("kiosk.ready.notApproved")}
              </p>
              <ul className="flex flex-wrap gap-x-6 font-extrabold text-foreground">
                {notApproved.slice(0, SHOWN_NOT_APPROVED).map((entry) => (
                  <li key={entry.ticketId}>{formatPlate(entry.plate)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </KioskFrame>
  );
}
