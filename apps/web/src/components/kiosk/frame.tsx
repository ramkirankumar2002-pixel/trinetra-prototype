"use client";

// KioskShell as every driver screen uses it: the status row, Help, Start over, the
// reminders when nobody answers, and the staff's way to log out.
import type { LucideIcon } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import type { IdleStage } from "@/lib/kiosk/idle";
import { KioskShell, type KioskShellProps } from "../layout/kiosk-shell";
import { LogoutButton } from "../logout-button";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { YesNo } from "../ui/yes-no";
import { KioskStatus } from "./kiosk-status";

export interface FrameState {
  /** Which screen is shown (lib/kiosk/flow.ts). */
  screen: string;
  dots: { current: number; total: number } | null;
  /** The ticket Help is about, once there is one. */
  ticketId: number | null;
  /** False on the Ready screen: there is nothing to start over. */
  canStartOver: boolean;
  startOver: () => void;
  idle: IdleStage;
  stay: () => void;
  staffOpen: boolean;
  setStaffOpen: (open: boolean) => void;
}

const FrameContext = createContext<FrameState | null>(null);
export const FrameProvider = FrameContext.Provider;

export function useFrame(): FrameState {
  const frame = useContext(FrameContext);
  if (!frame) throw new Error("useFrame needs a FrameProvider.");
  return frame;
}

/** Calls the store officer. True once the backend has the call. */
export async function callStoreOfficer(
  ticketId: number | null,
  /** "No phone?": the officer is told that a bill is needed. */
  noPhone = false,
): Promise<boolean> {
  await api.post("/api/help", {
    body: ticketId === null ? {} : { ticketId, ...(noPhone ? { noPhone } : {}) },
  });
  return true;
}

export function KioskFrame({
  header,
  actions,
  status = true,
  children,
}: {
  header: { icon: LucideIcon; title: string; subtitle?: string; hero?: boolean };
  actions?: KioskShellProps["actions"];
  /** The slip screens leave the status row out: a slip needs all the height. */
  status?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const frame = useFrame();
  return (
    <KioskShell
      header={header}
      status={status ? <KioskStatus dots={frame.dots} /> : undefined}
      actions={actions}
      onAskHelp={() => callStoreOfficer(frame.ticketId)}
      onStartOver={frame.canStartOver ? frame.startOver : undefined}
      onStaffHold={() => frame.setStaffOpen(true)}
    >
      {/* For tests and support: which screen this is. */}
      <span hidden data-testid="screen" data-screen={frame.screen} />
      {children}

      {/* Gentle: it covers no button and goes away at the next touch. */}
      {frame.idle === "remind" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 animate-pulse rounded-2xl bg-background motion-reduce:animate-none">
          <Banner tone="wait">
            <span role="alert">{t("kiosk.idle.remind")}</span>
          </Banner>
        </div>
      )}

      <Dialog open={frame.idle === "ask"} onOpenChange={(open) => !open && frame.stay()}>
        <DialogContent title={t("kiosk.startOverTitle")} description={t("kiosk.idle.ask")}>
          <YesNo
            yesLabel={t("common.yes")}
            noLabel={t("common.no")}
            onYes={frame.startOver}
            onNo={frame.stay}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={frame.staffOpen} onOpenChange={frame.setStaffOpen}>
        <DialogContent title={t("kiosk.staff.title")} description={t("kiosk.staff.text")}>
          <LogoutButton area="kiosk" variant="dark" />
          <Button onClick={() => frame.setStaffOpen(false)}>{t("common.ok")}</Button>
        </DialogContent>
      </Dialog>
    </KioskShell>
  );
}
