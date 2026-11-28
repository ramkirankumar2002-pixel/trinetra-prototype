"use client";

// The front page: what Trinetra does, the three parts, and how a truck goes through. It is
// in the weighbridge's dark style. The header sits on the logo's navy, outside that theme,
// so the language switch keeps its small size.
import { cn } from "cn";
import {
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  FileText,
  HardHat,
  Receipt,
  ScanLine,
  Scale,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { LogoFull } from "@/components/layout/brand";
import { ThemeRoot } from "@/components/layout/theme-root";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { AREAS, type AreaName } from "@/lib/areas";

const PARTS: { area: AreaName; icon: LucideIcon; title: MessageKey; text: MessageKey }[] = [
  { area: "kiosk", icon: Truck, title: "home.kiosk", text: "home.kioskText" },
  { area: "supervisor", icon: HardHat, title: "area.supervisor", text: "home.supervisorText" },
  { area: "store", icon: ClipboardCheck, title: "area.store", text: "home.storeText" },
];

const STEPS: { icon: LucideIcon; label: MessageKey }[] = [
  { icon: Truck, label: "home.step.arrives" },
  { icon: ScanLine, label: "home.step.plate" },
  { icon: FileText, label: "home.step.bill" },
  { icon: Scale, label: "home.step.weighed" },
  { icon: ShieldCheck, label: "home.step.verified" },
  { icon: Receipt, label: "home.step.slip" },
];

export function Home() {
  const t = useT();
  return (
    <div className="flex min-h-dvh flex-col bg-nav">
      <header className="relative flex flex-col items-center gap-3 border-b-2 border-white/10 px-4 py-3">
        <div className="w-full max-w-60 text-nav-foreground md:absolute md:top-4 md:right-4 md:w-60">
          <LanguageSwitch onNavy />
        </div>
        <h1>
          {/* The picture carries the name, so the heading reads "Trinetra Systems". */}
          <LogoFull className="w-36 md:w-40" />
        </h1>
      </header>

      <ThemeRoot theme="kiosk" className="kiosk-backdrop flex flex-1 flex-col">
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-5 px-4 py-5">
          <p className="text-center text-xl font-semibold text-balance text-highlight md:text-2xl">
            {t("home.line")}
          </p>

          <ul className="grid gap-4 md:grid-cols-3">
            {PARTS.map(({ area, icon: Icon, title, text }) => (
              <li key={area} className="flex">
                <Link
                  href={AREAS[area].home}
                  data-testid={`home-${area}`}
                  className={cn(
                    "flex w-full items-center gap-4 rounded-3xl border-2 border-primary-edge/70 p-4 text-left backdrop-blur-md outline-none",
                    "bg-linear-to-b from-[rgb(20_80_190/45%)] to-[rgb(6_26_66/70%)] shadow-[0_0_2rem_rgb(30_110_255/22%)]",
                    "transition-[filter] hover:brightness-125 focus-visible:ring-4 focus-visible:ring-ring",
                    "md:min-h-64 md:flex-col md:justify-center md:text-center",
                  )}
                >
                  <Icon
                    aria-hidden
                    className="size-14 shrink-0 text-highlight drop-shadow-[0_0_1rem_rgb(60_150_255/75%)] md:size-20"
                    strokeWidth={1.5}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1 md:flex-none">
                    <span className="text-2xl leading-tight font-bold md:text-3xl">{t(title)}</span>
                    <span className="text-base text-muted-foreground md:text-lg">{t(text)}</span>
                  </span>
                  <span
                    aria-hidden
                    className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-primary-edge/70"
                  >
                    <ArrowRight className="size-6" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <section
            aria-labelledby="how"
            className="rounded-2xl border border-card-border bg-card px-3 py-3"
          >
            <h2 id="how" className="mb-2 text-center text-base font-bold uppercase">
              {t("home.how")}
            </h2>
            <ol className="grid grid-cols-3 gap-y-3 md:flex md:items-start md:justify-between">
              {STEPS.map(({ icon: Icon, label }, index) => (
                <Fragment key={label}>
                  {index > 0 && (
                    <li aria-hidden className="hidden self-center text-highlight md:block">
                      <ChevronRight className="size-6" />
                    </li>
                  )}
                  <li className="flex min-w-0 flex-col items-center gap-1 px-1 text-center md:flex-1">
                    <span className="inline-flex size-12 items-center justify-center rounded-full border-2 border-highlight/60 bg-info-soft/60 text-highlight">
                      <Icon aria-hidden className="size-6" />
                    </span>
                    <span className="text-sm leading-tight font-semibold">{t(label)}</span>
                  </li>
                </Fragment>
              ))}
            </ol>
          </section>
        </main>
      </ThemeRoot>
    </div>
  );
}
