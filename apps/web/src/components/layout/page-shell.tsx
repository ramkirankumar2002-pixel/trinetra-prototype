// The frame of every screen: a top bar, the page, and a bottom bar.
//   kiosk: fills a landscape touchscreen (1920×1080 or 1366×768) and does not scroll.
//   phone: mobile first, with the bars staying in view while the page scrolls.
import { cn } from "cn";
import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeContext, type ThemeName } from "./theme-context";

export interface PageShellProps {
  layout: ThemeName;
  /** The product name, beside the logo. */
  brand: string;
  title?: ReactNode;
  /** Right side of the top bar: who is logged in, connection status. */
  topRight?: ReactNode;
  /** The bottom bar. Left out when there is nothing for it. */
  bottomBar?: ReactNode;
  children: ReactNode;
}

export function PageShell(props: PageShellProps) {
  const { layout, brand, title, topRight, bottomBar, children } = props;
  const kiosk = layout === "kiosk";

  return (
    <ThemeContext.Provider value={layout}>
      <div
        data-theme={layout}
        className={cn(
          "flex w-full flex-col bg-background text-foreground",
          kiosk ? "h-dvh overflow-hidden text-[2rem] leading-snug" : "min-h-dvh text-base",
        )}
      >
        <header
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 bg-background px-4 py-3",
            kiosk ? "min-h-24 px-8 py-2" : "sticky top-0 z-10",
          )}
        >
          <div className="flex items-center gap-3">
            <Eye aria-hidden className={kiosk ? "size-14" : "size-7"} />
            <div className="flex flex-col leading-tight kiosk:flex-row kiosk:items-baseline kiosk:gap-4">
              <span className="font-bold">{brand}</span>
              {title && <h1 className="text-muted-foreground">{title}</h1>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 kiosk:gap-x-8">
            {topRight}
          </div>
        </header>

        <main
          className={cn(
            "flex w-full flex-1 flex-col gap-4 p-4",
            // The kiosk should never need to scroll; this only keeps nothing unreachable.
            kiosk ? "min-h-0 overflow-auto px-8" : "mx-auto max-w-2xl",
          )}
        >
          {children}
        </main>

        {bottomBar && (
          <footer
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 border-t-2 bg-background px-4 py-3",
              kiosk ? "px-8 py-2" : "sticky bottom-0 z-10",
            )}
          >
            {bottomBar}
          </footer>
        )}
      </div>
    </ThemeContext.Provider>
  );
}
