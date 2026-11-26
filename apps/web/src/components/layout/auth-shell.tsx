// The dashboard theme's page without a menu: the full logo and one white card in the
// middle of a navy page. For the staff logins and other pages outside the dashboards.
import type { ReactNode } from "react";
import { LogoFull } from "./brand";
import { ThemeRoot } from "./theme-root";

export function AuthShell({ footer, children }: { footer?: ReactNode; children: ReactNode }) {
  return (
    <ThemeRoot theme="dashboard" className="flex min-h-dvh flex-col bg-nav text-base">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-4">
        <LogoFull className="w-36 sm:w-44" />
        <div className="w-full rounded-2xl bg-card p-4 text-card-foreground shadow-2xl sm:p-6">
          {children}
        </div>
        {footer && <div className="w-full max-w-60 text-nav-foreground">{footer}</div>}
      </main>
    </ThemeRoot>
  );
}
