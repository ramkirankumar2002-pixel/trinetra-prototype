// The pages of the supervisor and the store officer: the sidebar, the phone's drawer and
// its bottom tabs are all drawn from these lists.
import { CircleCheckBig, ClipboardList, LayoutDashboard, Truck, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MessageKey } from "@/i18n/translate";
import type { AreaName } from "./areas";

export type StaffArea = Exclude<AreaName, "kiosk">;

export interface MenuItem {
  href: string;
  icon: LucideIcon;
  label: MessageKey;
  /** For the narrow bottom tabs. */
  short: MessageKey;
  subtitle: MessageKey;
}

const dashboard = (area: StaffArea): MenuItem => ({
  href: `/${area}`,
  icon: LayoutDashboard,
  label: "menu.dashboard",
  short: "tab.dashboard",
  subtitle: area === "supervisor" ? "page.supervisor.subtitle" : "page.store.subtitle",
});

const done = (area: StaffArea): MenuItem => ({
  href: `/${area}/done`,
  icon: CircleCheckBig,
  label: "menu.done",
  short: "tab.done",
  subtitle: "page.done.subtitle",
});

const profile = (area: StaffArea): MenuItem => ({
  href: `/${area}/profile`,
  icon: UserRound,
  label: "menu.profile",
  short: "tab.profile",
  subtitle: "page.profile.subtitle",
});

export const MENUS: Record<StaffArea, readonly MenuItem[]> = {
  supervisor: [
    dashboard("supervisor"),
    {
      href: "/supervisor/trucks",
      icon: Truck,
      label: "menu.trucks",
      short: "tab.trucks",
      subtitle: "page.trucks.subtitle",
    },
    done("supervisor"),
    profile("supervisor"),
  ],
  store: [
    dashboard("store"),
    {
      href: "/store/requests",
      icon: ClipboardList,
      label: "menu.requests",
      short: "tab.requests",
      subtitle: "page.requests.subtitle",
    },
    done("store"),
    profile("store"),
  ],
};
