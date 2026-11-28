"use client";

// The frame of every weighbridge screen (docs/design/STYLE_GUIDE.md):
//   left rail    logo, name; at the bottom the language button, Help and Start over
//   top row      the page header, and the date and time
//   status row   step dots, the live weight and the weighbridge light
//   middle       one question; it must fit 1366×768 without scrolling
//   bottom bar   up to three big buttons
// The "phone" variant is the driver's upload page: the same look, one narrow column.
import { cn } from "cn";
import { Truck, type LucideIcon } from "lucide-react";
import { useRef, type MouseEvent, type ReactNode } from "react";
import { useT } from "@/i18n/use-t";
import { ClockChip } from "../clock-chip";
import { HelpButton } from "../kiosk/help-button";
import { StartOverButton } from "../kiosk/start-over-button";
import { LanguageToggle } from "../language-switch";
import { LogoMark } from "./brand";
import { ThemeRoot } from "./theme-root";

/** How long the logo is held to reach the staff's actions, such as "Log out". */
export const STAFF_HOLD_MS = 3000;

export interface KioskShellProps {
  /**
   * The page header. Left out only on a waiting screen. `hero` makes the title the main
   * message of the screen, such as "Go to Plant".
   */
  header?: { icon: LucideIcon; title: string; subtitle?: string; hero?: boolean };
  /** Live lights, such as the connection. Shown under the header. */
  status?: ReactNode;
  /** At most three buttons, left to right: "Wrong…" (danger), "Edit" (dark), "Next". */
  actions?: ReactNode;
  /** Calls the store officer. Without it, Help only says where to go. */
  onAskHelp?: (() => Promise<boolean>) | undefined;
  /** Shows "Start over", which asks first. */
  onStartOver?: (() => void) | undefined;
  /** For staff: the logo was held for 3 seconds. */
  onStaffHold?: (() => void) | undefined;
  /** A mark in the rail, such as "DEMO". */
  badge?: ReactNode;
  variant?: "kiosk" | "phone";
  children: ReactNode;
}

function Rail({
  onAskHelp,
  onStartOver,
  onStaffHold,
  badge,
}: Pick<KioskShellProps, "onAskHelp" | "onStartOver" | "onStaffHold" | "badge">) {
  const t = useT();
  const held = useRef<ReturnType<typeof setTimeout>>(undefined);
  const release = () => clearTimeout(held.current);
  const hold = () => {
    release();
    if (onStaffHold) held.current = setTimeout(onStaffHold, STAFF_HOLD_MS);
  };
  return (
    <aside className="flex w-64 shrink-0 flex-col items-center gap-3 border-r-2 border-card-border bg-nav p-3 text-center">
      <div
        data-testid="rail-logo"
        className="flex flex-col items-center gap-3 select-none"
        onPointerDown={hold}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        // A long touch must not open the browser's menu instead.
        onContextMenu={(event: MouseEvent) => event.preventDefault()}
      >
        <LogoMark className="pointer-events-none w-40" />
        {/* The company's name is the same in every language. */}
        <p className="flex flex-col text-[2rem] leading-[1.1] font-extrabold tracking-wide text-nav-foreground uppercase">
          <span>Trinetra</span>
          <span className="font-semibold tracking-[0.16em]">Systems</span>
        </p>
      </div>
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
      {badge}
      <div className="mt-auto flex w-full flex-col gap-3">
        <LanguageToggle className="w-full px-2" />
        <HelpButton className="w-full px-2" onAsk={onAskHelp} />
        {onStartOver && (
          <StartOverButton className="w-full kiosk:gap-2 kiosk:px-0" onStartOver={onStartOver} />
        )}
      </div>
    </aside>
  );
}

function Header({ header }: { header: NonNullable<KioskShellProps["header"]> }) {
  const { icon: Icon, title, subtitle, hero } = header;
  return (
    <div className="flex min-w-0 items-center gap-5 self-center">
      <span
        aria-hidden
        className="inline-flex size-22 shrink-0 items-center justify-center rounded-full border-2 border-highlight/70 bg-info-soft/60 text-highlight shadow-[0_0_1.5rem_rgb(40_200_235/40%),inset_0_0_1.25rem_rgb(40_150_255/30%)]"
      >
        <Icon className="size-12" />
      </span>
      <div className="min-w-0">
        <h1
          className={cn(
            "leading-tight font-extrabold",
            hero ? "text-[3rem] text-live" : "text-[2.5rem] uppercase",
          )}
        >
          {title}
        </h1>
        {subtitle && <p className="leading-tight text-highlight">{subtitle}</p>}
      </div>
    </div>
  );
}

function PhoneShell({ header, actions, children }: KioskShellProps) {
  const t = useT();
  const Icon = header?.icon;
  return (
    <ThemeRoot theme="kiosk" className="kiosk-backdrop flex min-h-dvh w-full flex-col text-xl">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex items-center justify-center gap-3 rounded-2xl bg-nav px-3 py-2">
          <LogoMark className="w-20" />
          <p className="flex flex-col leading-tight text-nav-foreground">
            <span className="font-extrabold uppercase">Trinetra Systems</span>
            <span className="text-base text-highlight">{t("area.kiosk")}</span>
          </p>
        </div>
        {header && Icon && (
          <header className="flex flex-col items-center gap-2 text-center">
            <span
              aria-hidden
              className="inline-flex size-16 items-center justify-center rounded-full border-2 border-highlight/70 bg-info-soft/60 text-highlight shadow-[0_0_1.5rem_rgb(40_200_235/40%)]"
            >
              <Icon className="size-9" />
            </span>
            <h1 className="text-2xl leading-tight font-extrabold uppercase">{header.title}</h1>
            {header.subtitle && <p className="text-highlight">{header.subtitle}</p>}
          </header>
        )}
        <main className="flex flex-1 flex-col gap-4">{children}</main>
        {actions && <footer className="flex flex-col gap-3">{actions}</footer>}
      </div>
    </ThemeRoot>
  );
}

export function KioskShell(props: KioskShellProps) {
  const { header, status, actions, children, variant = "kiosk" } = props;
  if (variant === "phone") return <PhoneShell {...props} />;
  return (
    <ThemeRoot
      theme="kiosk"
      className="kiosk-backdrop flex h-dvh w-full overflow-hidden text-[2rem] leading-snug"
    >
      <Rail {...props} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-4">
        <header className="flex min-h-24 shrink-0 items-start justify-between gap-6">
          {header ? <Header header={header} /> : <span />}
          {/* A hero heading needs the width; those screens show a slip with its own time. */}
          {!header?.hero && <ClockChip className="shrink-0" />}
        </header>

        {status && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">{status}</div>
        )}

        {/* The kiosk should never need to scroll; this only keeps nothing unreachable. */}
        <main className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
          {children}
        </main>

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
