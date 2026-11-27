"use client";

// The frame of a logged-in staff page (the supervisor and the store officer): who is
// logged in, the live connection, the language switch and "Log out". The weighbridge's
// screens have their own frame (components/kiosk/frame.tsx).
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { MENUS, type StaffArea } from "@/lib/menus";
import { useOnReconnect } from "@/lib/socket-hooks";
import { useStorePending } from "@/lib/store/queries";
import { useSupervisorTrucks } from "@/lib/supervisor/queries";
import { ConnectionStatusLight } from "./connection-status";
import { DashboardShell } from "./layout/dashboard-shell";
import { LogoutButton } from "./logout-button";
import { NetworkBanner } from "./network-banner";
import { useCurrentUser } from "./require-role";
import { StoreWatcher } from "./store/watcher";
import { TruckWatcher } from "./supervisor/watcher";
import { ToastProvider, useToast } from "./ui/toast";

function BackOnlineMessage() {
  const t = useT();
  const toast = useToast();
  useOnReconnect(() => toast({ tone: "go", title: t("shell.backOnline") }));
  return null;
}

/** Messages, inside the shell so they take its theme. */
function Messages({ area, children }: { area: StaffArea; children: ReactNode }) {
  const t = useT();
  return (
    <ToastProvider label={t("shell.notification")}>
      <BackOnlineMessage />
      {area === "supervisor" ? <TruckWatcher /> : <StoreWatcher />}
      <NetworkBanner />
      {children}
    </ToastProvider>
  );
}

export interface RoleShellProps {
  area: StaffArea;
  /** For a page that is not in the menu: the menu page it belongs to, and its own title. */
  page?: { section: string; title: MessageKey; subtitle: MessageKey };
  children: ReactNode;
}

export function RoleShell({ area, page: own, children }: RoleShellProps) {
  const t = useT();
  const user = useCurrentUser();
  const pathname = usePathname();
  const menu = MENUS[area];
  const wanted = own?.section ?? pathname;
  const page = menu.find((item) => item.href === wanted) ?? menu[0]!;
  const home = menu[0]!.href;
  const supervisor = area === "supervisor";
  const trucks = useSupervisorTrucks("pending", supervisor);
  const requests = useStorePending(!supervisor);

  return (
    <DashboardShell
      title={own ? t(own.title) : t(page.href === home ? `area.${area}` : page.label)}
      subtitle={t(own?.subtitle ?? page.subtitle)}
      menu={menu}
      active={page.href}
      user={{ name: user.name, role: t(`area.${area}`), profileHref: `${home}/profile` }}
      status={<ConnectionStatusLight />}
      alerts={
        supervisor
          ? { count: trucks.data?.tickets.length ?? 0, href: `${home}/trucks` }
          : { count: requests.data?.requests.length ?? 0, href: `${home}/approvals` }
      }
      logout={<LogoutButton area={area} variant="nav-danger" className="w-full" />}
    >
      <Messages area={area}>{children}</Messages>
    </DashboardShell>
  );
}
