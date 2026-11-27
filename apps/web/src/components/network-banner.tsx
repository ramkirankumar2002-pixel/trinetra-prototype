"use client";

// A clear word when the network is lost. Nothing is kept to be sent later: what was not
// sent has not happened.
import { useSyncExternalStore } from "react";
import { useT } from "@/i18n/use-t";
import { useSocketStatus } from "@/lib/socket-hooks";
import { Banner } from "./ui/banner";

function onNetworkChange(changed: () => void) {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
}

export function NetworkBanner() {
  const t = useT();
  const status = useSocketStatus();
  const online = useSyncExternalStore(
    onNetworkChange,
    () => navigator.onLine,
    () => true,
  );
  if (online && status !== "reconnecting") return null;
  return (
    <Banner tone="stop">
      <span role="alert">{t("sup.offline")}</span>
    </Banner>
  );
}
