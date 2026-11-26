"use client";

// The frame of a logged-in page: who is logged in and the connection at the top; the
// language switch and "Log out" at the bottom.
import { UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t";
import type { AreaName } from "@/lib/areas";
import { useOnReconnect } from "@/lib/socket-hooks";
import { ConnectionStatusLight, WeighbridgeStatusLight } from "./connection-status";
import { LanguageSwitch } from "./language-switch";
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

  return (
    <PageShell
      layout={area === "kiosk" ? "kiosk" : "phone"}
      brand={t("app.name")}
      title={t(`area.${area}`)}
      topRight={
        <>
          <span className="inline-flex items-center gap-2 text-sm font-semibold kiosk:text-[2rem]">
            <UserRound aria-hidden className="size-5 kiosk:size-10" />
            {t("shell.loggedInAs", { name: user.name })}
          </span>
          {area === "kiosk" && <WeighbridgeStatusLight />}
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
