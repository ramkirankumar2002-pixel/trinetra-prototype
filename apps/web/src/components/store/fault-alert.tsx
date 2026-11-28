"use client";

// A weighbridge fault, told to the store officer on every one of their pages: a banner for
// as long as it lasts, and a message with a sound when it begins and ends.
import { formatIST, type HardwareFaultEvent, type WeighbridgeFault } from "@trinetra/shared";
import { useRef, useState } from "react";
import { useT } from "@/i18n/use-t";
import { useSocketEvent } from "@/lib/socket-hooks";
import { ringForTruck } from "@/lib/supervisor/alerts";
import { Banner } from "../ui/banner";
import { useToast } from "../ui/toast";

/**
 * The fault already announced. Kept outside the component, so that moving between pages
 * does not make an old fault news again.
 */
let announced: string | null = null;

export function FaultAlert() {
  const t = useT();
  const toast = useToast();
  const [fault, setFault] = useState<WeighbridgeFault | null>(null);
  const showing = useRef(false);

  // The backend sends the current state on every connection, so nothing is asked for.
  useSocketEvent("hw:fault", (event: HardwareFaultEvent) => {
    setFault(event.fault);
    if (event.fault && announced !== event.fault.since) {
      announced = event.fault.since;
      ringForTruck();
      toast({ tone: "stop", title: t("store.fault.title") });
    } else if (!event.fault && showing.current) {
      toast({ tone: "go", title: t("store.fault.cleared") });
    }
    showing.current = event.fault !== null;
  });

  if (!fault) return null;
  return (
    <Banner tone="stop" className="mb-4">
      <div role="alert" data-testid="store-fault">
        <strong>{t("store.fault.title")}</strong>{" "}
        {t("store.fault.text", {
          reason: fault.reason,
          time: formatIST(new Date(fault.since)),
        })}
      </div>
    </Banner>
  );
}
