"use client";

// One big message with its icon: "wait here", "go to the store office".
import type { TicketView } from "@trinetra/shared";
import { cn } from "cn";
import { Ban, CircleAlert, Clock, Hourglass, Scale, Store, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import type { Screen } from "@/lib/kiosk/flow";
import { SURFACE } from "../../ui/card";
import { Spinner } from "../../ui/spinner";
import { TONE_GLOW, TONE_SOLID, type Tone } from "../../ui/tone";
import { KioskFrame } from "../frame";

export type MessageScreenName = Extract<
  Screen,
  "waitStore" | "mismatch" | "notApprovedEarlier" | "rejected" | "blocked" | "hold" | "timedOut"
>;

const MESSAGES: Record<
  MessageScreenName,
  { tone: Tone; icon: LucideIcon; heading: MessageKey; title: MessageKey; text: MessageKey }
> = {
  waitStore: {
    tone: "wait",
    icon: Hourglass,
    heading: "kiosk.heading.wait",
    title: "kiosk.waitStore.title",
    text: "kiosk.waitStore.text",
  },
  mismatch: {
    tone: "stop",
    icon: Store,
    heading: "kiosk.heading.storeOffice",
    title: "kiosk.goStore",
    text: "kiosk.mismatch.text",
  },
  notApprovedEarlier: {
    tone: "stop",
    icon: Store,
    heading: "kiosk.heading.storeOffice",
    title: "kiosk.notApprovedEarlier.title",
    text: "kiosk.goStore",
  },
  rejected: {
    tone: "stop",
    icon: Ban,
    heading: "kiosk.heading.notApproved",
    title: "kiosk.rejected.title",
    text: "kiosk.rejected.text",
  },
  blocked: {
    tone: "stop",
    icon: Ban,
    heading: "kiosk.heading.notApproved",
    title: "kiosk.blocked.title",
    text: "kiosk.goStore",
  },
  hold: {
    tone: "stop",
    icon: Scale,
    heading: "kiosk.heading.storeOffice",
    title: "kiosk.hold.title",
    text: "kiosk.goStore",
  },
  timedOut: {
    tone: "wait",
    icon: Clock,
    heading: "kiosk.heading.ended",
    title: "kiosk.timedOut.title",
    text: "kiosk.timedOut.text",
  },
};

export function MessageScreen({
  name,
  ticket,
}: {
  name: MessageScreenName;
  ticket: TicketView | undefined;
}) {
  const t = useT();
  const { tone, icon: Icon, heading, title, text } = MESSAGES[name];
  return (
    <KioskFrame
      header={{
        icon: CircleAlert,
        title: t(heading),
        ...(ticket ? { subtitle: ticket.ticketNo } : {}),
      }}
    >
      <div
        data-testid={`message-${name}`}
        data-tone={tone}
        role="status"
        className={cn(
          SURFACE,
          "flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-flex size-40 items-center justify-center rounded-full",
            TONE_SOLID[tone],
            TONE_GLOW[tone],
          )}
        >
          <Icon className="size-24" strokeWidth={2} />
        </span>
        <p className="text-[3rem] leading-tight font-extrabold text-balance">{t(title)}</p>
        <p className="leading-tight text-muted-foreground">{t(text)}</p>
      </div>
    </KioskFrame>
  );
}

export function LoadingScreen() {
  const t = useT();
  return (
    <KioskFrame header={{ icon: Clock, title: t("kiosk.heading.wait") }}>
      <Spinner className="flex-1 flex-col" label={t("kiosk.loading")} />
    </KioskFrame>
  );
}
