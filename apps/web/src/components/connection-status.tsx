"use client";

import { useState } from "react";
import { useT } from "@/i18n/use-t";
import type { MessageKey } from "@/i18n/translate";
import type { ConnectionStatus } from "@/lib/socket";
import { useSocketEvent, useSocketStatus } from "@/lib/socket-hooks";
import { StatusLight } from "./ui/status-light";
import type { Tone } from "./ui/tone";

const SHOWN: Record<ConnectionStatus, { tone: Tone; key: MessageKey }> = {
  connected: { tone: "go", key: "connection.online" },
  idle: { tone: "wait", key: "connection.connecting" },
  connecting: { tone: "wait", key: "connection.connecting" },
  reconnecting: { tone: "stop", key: "connection.offline" },
  // The page is about to leave for the login.
  "login-required": { tone: "stop", key: "connection.offline" },
};

/** This screen's own link to the server. */
export function ConnectionStatusLight() {
  const t = useT();
  const { tone, key } = SHOWN[useSocketStatus()];
  return <StatusLight data-testid="connection" tone={tone} label={t(key)} />;
}

/** Whether the weighbridge's ESP32 is online, from the live "hw:status" news. */
export function WeighbridgeStatusLight() {
  const t = useT();
  const connected = useSocketStatus() === "connected";
  const [online, setOnline] = useState<boolean | null>(null);
  // The backend also sends it as soon as the kiosk connects.
  useSocketEvent("hw:status", (event) => setOnline(event.main));

  // Without a connection, the last news may be old.
  const known = connected ? online : null;
  return (
    <StatusLight
      data-testid="weighbridge"
      tone={known === null ? "neutral" : known ? "go" : "stop"}
      label={t(
        known === null
          ? "weighbridge.checking"
          : known
            ? "weighbridge.online"
            : "weighbridge.offline",
      )}
    />
  );
}
