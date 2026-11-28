"use client";

// The weighbridge: one page that shows the right screen for the truck on the bridge. It
// listens to the weighbridge and the backend, and wakes and sleeps by itself.
import { useQueryClient } from "@tanstack/react-query";
import type { KioskStateResponse, TicketView } from "@trinetra/shared";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLanguage } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { useBridge } from "@/lib/kiosk/bridge";
import { QUESTION_SCREENS, screenOf, stepDots, useKiosk, type Screen } from "@/lib/kiosk/flow";
import { useInactivity } from "@/lib/kiosk/idle";
import { COLLECT_KEY, usePutTicket, useTicket } from "@/lib/kiosk/queries";
import { useOnReconnect, useSocketEvent, useSocketStatus } from "@/lib/socket-hooks";
import { FrameProvider } from "./frame";
import { CheckScreen } from "./screens/check";
import { InvoiceScreen } from "./screens/invoice";
import { LoadScreen } from "./screens/load";
import { LoadingScreen, MessageScreen } from "./screens/message";
import { PlateScreen } from "./screens/plate";
import { MaterialScreen, NameScreen, PartyScreen, PhoneScreen } from "./screens/questions";
import { ReadyScreen } from "./screens/ready";
import { CollectScreen, ResultScreen, WelcomeBackScreen } from "./screens/results";
import { LanguageScreen, PositionScreen } from "./screens/start";
import { WeighScreen } from "./screens/weigh";

/** The weighbridge's live news, and its state whenever news may have been missed. */
function useBridgeFeed() {
  const connected = useSocketStatus() === "connected";
  const load = useCallback(() => {
    api
      .get<KioskStateResponse>("/api/kiosk/state")
      .then((state) => useBridge.getState().snapshot(state))
      // The live events carry on; the next reconnect asks again.
      .catch(() => {});
  }, []);
  useSocketEvent("hw:weight", (event) => useBridge.getState().weight(event));
  useSocketEvent("hw:status", (event) => {
    useBridge.getState().status(event);
    // "Last seen" comes only with the state.
    load();
  });
  useSocketEvent("hw:fault", (event) => useBridge.getState().setFault(event.fault));
  useSocketEvent("truck:arrived", () => useBridge.getState().arrived());
  useSocketEvent("truck:left", () => useBridge.getState().left());
  useEffect(() => {
    if (connected) load();
  }, [connected, load]);
  useOnReconnect(load);
  useEffect(() => () => useBridge.getState().clear(), []);
}

/** Something changed at the backend: load the ticket and the lists again. */
function useTicketNews() {
  const queryClient = useQueryClient();
  const reload = useCallback(
    (ticketId: number | null) => {
      if (ticketId !== null) void queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      void queryClient.invalidateQueries({ queryKey: COLLECT_KEY });
    },
    [queryClient],
  );
  useSocketEvent("ticket:updated", (event) => reload(event.ticketId));
  useSocketEvent("invoice:read", (event) => reload(event.ticketId));
  useSocketEvent("approval:decided", (event) => reload(event.ticketId));
  useSocketEvent("kiosk:ready", (event) => reload(event.ticketId));
}

/** Wakes the kiosk for a truck, and puts it back to Ready when the truck leaves. */
function useTruck() {
  const present = useBridge((state) => state.truckPresent);
  const departures = useBridge((state) => state.departures);
  const step = useKiosk((state) => state.step);
  const served = useKiosk((state) => state.served);

  useEffect(() => {
    if (departures > 0) useKiosk.getState().truckLeft();
  }, [departures]);

  useEffect(() => {
    if (present && step === null && !served) useKiosk.getState().wake();
    if (!present && served) useKiosk.getState().bridgeFree();
  }, [present, step, served]);
}

/** The ticket keeps the driver's language, so the phone page opens in it. */
function useTicketLanguage(ticket: TicketView | undefined, ticketId: number | null) {
  const { language } = useLanguage();
  const putTicket = usePutTicket();
  const stale =
    ticket !== undefined &&
    ticket.id === ticketId &&
    ticket.status === "STARTED" &&
    ticket.language !== language;
  useEffect(() => {
    if (!stale) return;
    api
      .patch<{ ticket: TicketView }>(`/api/tickets/${ticketId}/details`, { body: { language } })
      .then((answer) => putTicket(answer.ticket))
      // Not worth stopping the driver for: the next switch tries again.
      .catch(() => {});
  }, [stale, ticketId, language, putTicket]);
}

function screenFor(screen: Screen, ticket: TicketView | undefined): ReactNode {
  switch (screen) {
    case "ready":
      return <ReadyScreen />;
    case "collect":
      return <CollectScreen />;
    case "language":
      return <LanguageScreen />;
    case "position":
      return <PositionScreen />;
    case "plate":
      return <PlateScreen />;
    case "fault":
    case "waitStore":
    case "mismatch":
    case "notApprovedEarlier":
    case "rejected":
    case "blocked":
    case "hold":
    case "timedOut":
      return <MessageScreen name={screen} ticket={ticket} />;
    case "loading":
      return <LoadingScreen />;
  }
  if (!ticket) return <LoadingScreen />;
  switch (screen) {
    case "load":
      return <LoadScreen ticket={ticket} />;
    case "invoice":
      return <InvoiceScreen ticket={ticket} />;
    case "material":
      return <MaterialScreen ticket={ticket} />;
    case "supplier":
    case "transporter":
      // A new question starts afresh.
      return <PartyScreen key={screen} field={screen} ticket={ticket} />;
    case "phone":
      return <PhoneScreen ticket={ticket} />;
    case "name":
      return <NameScreen ticket={ticket} />;
    case "check":
      return <CheckScreen ticket={ticket} />;
    case "weigh1":
      return <WeighScreen key="first" which="first" ticket={ticket} />;
    case "weighEmpty":
      return <WeighScreen key="empty" which="empty" ticket={ticket} />;
    case "weigh2":
      return <WeighScreen key="second" which="second" ticket={ticket} />;
    case "result1":
      return <ResultScreen key="first" ticket={ticket} slip="FIRST" />;
    case "finalSlip":
    case "emptySlip":
      return <ResultScreen key="final" ticket={ticket} slip="FINAL" />;
    case "visit2":
      return <WelcomeBackScreen ticket={ticket} />;
  }
}

export function KioskApp() {
  useBridgeFeed();
  useTicketNews();
  useTruck();

  const step = useKiosk((state) => state.step);
  const ticketId = useKiosk((state) => state.ticketId);
  const collect = useKiosk((state) => state.collect);
  const visit = useKiosk((state) => state.visit);
  const driver = useKiosk((state) => state.driver);
  const startOver = useKiosk((state) => state.startOver);
  const positionBad = useBridge((state) => state.reading?.reason === "POSITION_NOT_OK");
  const faulty = useBridge((state) => state.fault !== null);
  const { data } = useTicket(ticketId);
  const ticket = data && data.id === ticketId ? data : undefined;
  useTicketLanguage(ticket, ticketId);

  const screen = screenOf({ step, ticketId, collect }, ticket, positionBad, faulty);
  // Waiting for the store officer is not a driver who has stopped answering.
  const waitingForOfficer = useKiosk((state) => state.noPhone) && screen === "invoice";
  const { stage, stay } = useInactivity(
    QUESTION_SCREENS.has(screen) && !waitingForOfficer,
    `${driver}:${screen}`,
  );
  const [staffOpen, setStaffOpen] = useState(false);

  return (
    <FrameProvider
      value={{
        screen,
        dots: stepDots(screen, visit),
        ticketId,
        canStartOver: step !== null,
        startOver,
        idle: stage,
        stay,
        staffOpen,
        setStaffOpen,
      }}
    >
      {screenFor(screen, ticket)}
    </FrameProvider>
  );
}
