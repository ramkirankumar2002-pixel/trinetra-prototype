"use client";

// The frame of a logged-in page: who is logged in and the connection at the top; the
// language switch and "Log out" at the bottom.
import { Truck, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t";
import type { AreaName } from "@/lib/areas";
import { useOnReconnect } from "@/lib/socket-hooks";
import { ConnectionStatusLight, WeighbridgeStatusLight } from "./connection-status";
import { LanguageSwitch } from "./language-switch";
import { KioskShell } from "./layout/kiosk-shell";
import { PageShell } from "./layout/page-shell";
import { LogoutButton } from "./logout-button";
import { useCurrentUser } from "./require-role";
import { ToastProvider, useToast } from "./ui/toast";

function BackOnlineMessage() {
  const t = useT();
  const toast = useToast();
  useOnReconnect(() => toast({ tone: "go", title: t("shell.backOnline") }));
  return null;
}

export function RoleShell({ area, children }: { area: AreaName; children: ReactNode }) {
  const t = useT();
  const user = useCurrentUser();

  if (area === "kiosk") {
    return (
      <KioskShell
        header={{
          icon: Truck,
          title: t("area.kiosk"),
          subtitle: t("shell.loggedInAs", { name: user.name }),
        }}
        status={
          <>
            <WeighbridgeStatusLight />
            <ConnectionStatusLight />
          </>
        }
        actions={<LogoutButton area={area} variant="dark" />}
      >
        <ToastProvider label={t("shell.notification")}>
          <BackOnlineMessage />
          {children}
        </ToastProvider>
      </KioskShell>
    );
  }

  return (
    <PageShell
      layout="dashboard"
      brand={t("app.name")}
      title={t(`area.${area}`)}
      topRight={
        <>
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <UserRound aria-hidden className="size-5" />
            {t("shell.loggedInAs", { name: user.name })}
          </span>
          <ConnectionStatusLight />
        </>
      }
      bottomBar={
        <>
          <LanguageSwitch />
          <LogoutButton area={area} />
        </>
      }
    >
      <ToastProvider label={t("shell.notification")}>
        <BackOnlineMessage />
        {children}
      </ToastProvider>
    </PageShell>
  );
}
