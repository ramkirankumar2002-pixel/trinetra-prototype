"use client";

// The frame of the supervisor's and the store officer's pages (docs/design/STYLE_GUIDE.md).
//   768 px and wider  navy sidebar with the full logo, and a navy top bar
//   below 768 px      the sidebar is a drawer behind the menu button, with tabs at the
//                     bottom
import { cn } from "cn";
import { Bell, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { Dialog as Primitive } from "radix-ui";
import { useState, type ReactNode } from "react";
import { useT } from "@/i18n/use-t";
import type { MenuItem } from "@/lib/menus";
import { ClockChip } from "../clock-chip";
import { LanguageSwitch } from "../language-switch";
import { LogoFull } from "./brand";
import { ThemeRoot } from "./theme-root";

export interface DashboardShellProps {
  title: string;
  subtitle?: string;
  menu: readonly MenuItem[];
  /** The href of the page being shown. */
  active: string;
  user: { name: string; role: string; profileHref: string };
  /** The live connection light, in the top bar. */
  status?: ReactNode;
  alerts: { count: number; href: string };
  /** The Logout button, at the bottom of the sidebar and the drawer. */
  logout: ReactNode;
  children: ReactNode;
}

function SideMenu({
  menu,
  active,
  logout,
  onNavigate,
}: Pick<DashboardShellProps, "menu" | "active" | "logout"> & { onNavigate?: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <LogoFull className="mx-auto w-36 shrink-0" />
      <nav aria-label={t("menu.label")}>
        <ul className="flex flex-col gap-1">
          {menu.map(({ href, icon: Icon, label }) => (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={href === active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium outline-none focus-visible:ring-4 focus-visible:ring-ring/60",
                  href === active
                    ? "bg-linear-to-r from-nav-active to-nav-active-to font-semibold text-nav-foreground shadow-primary"
                    : "text-nav-muted hover:bg-white/8 hover:text-nav-foreground",
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                {t(label)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto flex flex-col gap-3">
        <LanguageSwitch onNavy />
        {logout}
      </div>
    </div>
  );
}

const BAR_BUTTON =
  "size-11 shrink-0 items-center justify-center rounded-lg text-nav-foreground outline-none hover:bg-white/10 focus-visible:ring-4 focus-visible:ring-ring/60";

export function DashboardShell(props: DashboardShellProps) {
  const { title, subtitle, menu, active, user, status, alerts, logout, children } = props;
  const t = useT();
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** On a wide screen the menu button hides the sidebar, for more room. */
  const [hidden, setHidden] = useState(false);

  return (
    <ThemeRoot theme="dashboard" className="min-h-dvh text-base">
      {!hidden && (
        <aside
          data-testid="sidebar"
          className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-nav md:block"
        >
          <SideMenu menu={menu} active={active} logout={logout} />
        </aside>
      )}

      <div className={cn("flex min-h-dvh flex-col", !hidden && "md:pl-60")}>
        <header className="sticky top-0 z-20 flex min-h-16 items-center gap-2 bg-linear-to-r from-bar to-bar-to px-2 py-2 text-nav-foreground md:min-h-20 md:gap-4 md:px-4">
          <Primitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <Primitive.Trigger className={cn(BAR_BUTTON, "inline-flex md:hidden")}>
              <Menu aria-hidden className="size-6" />
              <span className="sr-only">{t("menu.open")}</span>
            </Primitive.Trigger>
            <Primitive.Portal>
              <Primitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
              <Primitive.Content
                data-theme="dashboard"
                aria-describedby={undefined}
                className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-nav text-nav-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-left motion-reduce:animate-none"
              >
                <Primitive.Title className="sr-only">{t("menu.label")}</Primitive.Title>
                <Primitive.Close className={cn(BAR_BUTTON, "absolute top-2 right-2 inline-flex")}>
                  <X aria-hidden className="size-6" />
                  <span className="sr-only">{t("menu.close")}</span>
                </Primitive.Close>
                <SideMenu
                  menu={menu}
                  active={active}
                  logout={logout}
                  onNavigate={() => setDrawerOpen(false)}
                />
              </Primitive.Content>
            </Primitive.Portal>
          </Primitive.Root>
          <button
            type="button"
            aria-expanded={!hidden}
            onClick={() => setHidden((value) => !value)}
            className={cn(BAR_BUTTON, "hidden md:inline-flex")}
          >
            <Menu aria-hidden className="size-6" />
            <span className="sr-only">{t(hidden ? "menu.open" : "menu.close")}</span>
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-bold md:text-2xl">{title}</h1>
            <div className="flex items-center gap-3 text-sm text-nav-muted">
              {subtitle && <p className="hidden truncate lg:block">{subtitle}</p>}
              {status}
            </div>
          </div>

          <ClockChip className="hidden border-r border-white/15 pr-4 md:inline-flex" />

          <Link
            href={alerts.href}
            className={cn(BAR_BUTTON, "relative inline-flex")}
            data-testid="bell"
          >
            <Bell aria-hidden className="size-6" />
            {alerts.count > 0 && (
              <span
                aria-hidden
                className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-stop px-1 text-xs font-bold text-stop-foreground"
              >
                {alerts.count}
              </span>
            )}
            <span className="sr-only">{t("topbar.alerts", { count: alerts.count })}</span>
          </Link>

          <Link
            href={user.profileHref}
            className="flex shrink-0 items-center gap-3 rounded-lg p-1 outline-none focus-visible:ring-4 focus-visible:ring-ring/60 md:border-l md:border-white/15 md:pl-4"
          >
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-kpi-blue text-kpi-blue-ink">
              <UserRound aria-hidden className="size-6" />
            </span>
            <span className="sr-only leading-tight xl:not-sr-only xl:flex xl:flex-col">
              <span className="text-sm font-semibold">{user.name}</span>
              <span className="text-sm text-nav-muted">{user.role}</span>
            </span>
          </Link>
        </header>

        {/* Room at the bottom for the phone's tabs. */}
        <main className="flex-1 p-3 pb-24 md:p-5 md:pb-6">
          <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4">{children}</div>
        </main>

        <nav
          aria-label={t("menu.tabs")}
          className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-card md:hidden"
        >
          <ul className="grid auto-cols-fr grid-flow-col">
            {menu.map(({ href, icon: Icon, short }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={href === active ? "page" : undefined}
                  className={cn(
                    "flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-center text-xs leading-tight outline-none focus-visible:ring-4 focus-visible:ring-ring/60 focus-visible:ring-inset",
                    href === active ? "font-bold text-accent-foreground" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-7 w-12 items-center justify-center rounded-full",
                      href === active && "bg-accent",
                    )}
                  >
                    <Icon aria-hidden className="size-5" />
                  </span>
                  {t(short)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </ThemeRoot>
  );
}
