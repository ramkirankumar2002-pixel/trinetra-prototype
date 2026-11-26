"use client";

// The frame of a logged-in page: the kiosk gets KioskShell, the supervisor and the store
// officer get DashboardShell. Both show who is logged in, the live connection, the
// language switch and "Log out".
import { Truck } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t";
import type { AreaName } from "@/lib/areas";
import { MENUS, type StaffArea } from "@/lib/menus";
import { SAMPLE_ALERTS } from "@/lib/sample-data";
import { useOnReconnect } from "@/lib/socket-hooks";
import { ConnectionStatusLight, WeighbridgeStatusLight } from "./connection-status";
import { DashboardShell } from "./layout/dashboard-shell";
import { KioskShell } from "./layout/kiosk-shell";
import { LogoutButton } from "./logout-button";
import { useCurrentUser } from "./require-role";
import { ToastProvider, useToast } from "./ui/toast";

function BackOnlineMessage() {
  const t = useT();
  const toast = useToast();
  useOnReconnect(() => toast({ tone: "go", title: t("shell.backOnline") }));
  return null;
}

/** Messages, inside the shell so they take its theme. */
function Messages({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <ToastProvider label={t("shell.notification")}>
      <BackOnlineMessage />
      {children}
    </ToastProvider>
  );
}

function KioskPage({ children }: { children: ReactNode }) {
  const t = useT();
  const user = useCurrentUser();
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
      actions={<LogoutButton area="kiosk" variant="dark" />}
    >
      <Messages>{children}</Messages>
    </KioskShell>
  );
}

function StaffPage({ area, children }: { area: StaffArea; children: ReactNode }) {
  const t = useT();
  const user = useCurrentUser();
  const pathname = usePathname();
  const menu = MENUS[area];
  const page = menu.find((item) => item.href === pathname) ?? menu[0]!;
  const home = menu[0]!.href;

  return (
    <DashboardShell
      title={t(page.href === home ? `area.${area}` : page.label)}
      subtitle={t(page.subtitle)}
      menu={menu}
      active={page.href}
      user={{ name: user.name, role: t(`area.${area}`), profileHref: `${home}/profile` }}
      status={<ConnectionStatusLight />}
      // Sample alerts until Phases 12 and 13.
      alerts={{ count: SAMPLE_ALERTS[area].length, href: `${home}#alerts` }}
      logout={<LogoutButton area={area} variant="nav-danger" className="w-full" />}
    >
      <Messages>{children}</Messages>
    </DashboardShell>
  );
}

export function RoleShell({ area, children }: { area: AreaName; children: ReactNode }) {
  return area === "kiosk" ? (
    <KioskPage>{children}</KioskPage>
  ) : (
    <StaffPage area={area}>{children}</StaffPage>
  );
}
