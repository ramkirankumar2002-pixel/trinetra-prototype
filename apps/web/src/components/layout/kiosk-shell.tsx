"use client";

// The frame of every weighbridge screen (docs/design/STYLE_GUIDE.md):
//   left rail    logo, name, the language button and Help
//   top row      the page header, and the date and time
//   middle       one question; it must fit 1366×768 without scrolling
//   bottom bar   up to three big buttons
import { Truck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t";
import { ClockChip } from "../clock-chip";
import { HelpButton } from "../kiosk/help-button";
import { LanguageToggle } from "../language-switch";
import { LogoMark } from "./brand";
import { ThemeRoot } from "./theme-root";

export interface KioskShellProps {
  /** The page header. Left out only on a waiting screen. */
  header?: { icon: LucideIcon; title: string; subtitle?: string };
  /** Live lights, such as the connection. Shown under the header. */
  status?: ReactNode;
  /** At most three buttons, left to right: "Wrong…" (danger), "Edit" (dark), "Next". */
  actions?: ReactNode;
  children: ReactNode;
}

function Rail() {
  const t = useT();
  return (
    <aside className="flex w-64 shrink-0 flex-col items-center gap-3 border-r-2 border-card-border bg-nav p-3 text-center">
      <LogoMark className="w-40" />
      {/* The company's name is the same in every language. */}
      <p className="flex flex-col text-[2rem] leading-[1.1] font-extrabold tracking-wide text-nav-foreground uppercase">
        <span>Trinetra</span>
        <span className="font-semibold tracking-[0.16em]">Systems</span>
      </p>
      {/*
       * The product's name, as a tag under the logo: two short lines like the reference.
       * It is branding, not something a driver has to read, so it may be under 32 px.
       */}
      <div data-brand-tagline className="flex flex-col items-center gap-1">
        <Truck aria-hidden className="size-10 text-highlight" strokeWidth={1.5} />
        <p className="flex flex-col text-[1.0625rem] leading-snug font-semibold tracking-wide uppercase">
          <span className="whitespace-nowrap text-nav-foreground">{t("kiosk.systemName")}</span>
          <span className="whitespace-nowrap text-highlight">{t("kiosk.systemNameSecond")}</span>
        </p>
      </div>
      <div className="mt-auto flex w-full flex-col gap-3">
        <LanguageToggle className="w-full px-2" />
        <HelpButton className="w-full px-2" />
      </div>
    </aside>
  );
}

export function KioskShell({ header, status, actions, children }: KioskShellProps) {
  const HeaderIcon = header?.icon;
  return (
    <ThemeRoot
      theme="kiosk"
      className="kiosk-backdrop flex h-dvh w-full overflow-hidden text-[2rem] leading-snug"
    >
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-4">
        <header className="flex min-h-24 shrink-0 items-start justify-between gap-6">
          {header && HeaderIcon ? (
            <div className="flex min-w-0 items-center gap-5 self-center">
              <span
                aria-hidden
                className="inline-flex size-22 shrink-0 items-center justify-center rounded-full border-2 border-highlight/70 bg-info-soft/60 text-highlight shadow-[0_0_1.5rem_rgb(40_200_235/40%),inset_0_0_1.25rem_rgb(40_150_255/30%)]"
              >
                <HeaderIcon className="size-12" />
              </span>
              <div className="min-w-0">
                <h1 className="text-[2.5rem] leading-tight font-extrabold uppercase">
                  {header.title}
                </h1>
                {header.subtitle && (
                  <p className="leading-tight text-highlight">{header.subtitle}</p>
                )}
              </div>
            </div>
          ) : (
            <span />
          )}
          <ClockChip className="shrink-0" />
        </header>

        {status && <div className="flex shrink-0 flex-wrap justify-end gap-3">{status}</div>}

        {/* The kiosk should never need to scroll; this only keeps nothing unreachable. */}
        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">{children}</main>

        {actions && (
          <footer
            data-testid="actions"
            className="grid shrink-0 auto-cols-fr grid-flow-col gap-4 [&>button]:px-3"
          >
            {actions}
          </footer>
        )}
      </div>
    </ThemeRoot>
  );
}
