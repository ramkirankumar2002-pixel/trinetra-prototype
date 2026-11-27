"use client";

import { useT } from "@/i18n/use-t";
import type { MessageKey } from "@/i18n/translate";
import type { ConnectionStatus } from "@/lib/socket";
import { useSocketStatus } from "@/lib/socket-hooks";
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
export function ConnectionStatusLight({ testId = "connection" }: { testId?: string }) {
  const t = useT();
  const { tone, key } = SHOWN[useSocketStatus()];
  return <StatusLight data-testid={testId} tone={tone} label={t(key)} />;
}
