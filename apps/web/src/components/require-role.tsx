"use client";

// Keeps a part of the website for its own role. This only decides what to show: the
// backend checks the role again on every request.
import type { AuthUser } from "@trinetra/shared";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useT } from "@/i18n/use-t";
import { AREAS, loginPath, type AreaName } from "@/lib/areas";
import { isTemporary, useMe } from "@/lib/session";
import { AuthShell } from "./layout/auth-shell";
import { KioskShell } from "./layout/kiosk-shell";
import { LiveConnection } from "./live-connection";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

const UserContext = createContext<AuthUser | null>(null);

/** The logged-in user. Only inside RequireRole. */
export function useCurrentUser(): AuthUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useCurrentUser needs RequireRole.");
  return user;
}

export function RequireRole({ area, children }: { area: AreaName; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { data: user, error, refetch } = useMe();
  const { role } = AREAS[area];
  const wrongRole = user !== undefined && user.role !== role;

  useEffect(() => {
    // Logged in as someone else: to this part's own login. (No login at all is sent
    // there by the API client.)
    if (wrongRole) router.replace(loginPath(area, pathname));
  }, [wrongRole, router, area, pathname]);

  // Once known, the user stays shown while the server is out of reach.
  if (user && !wrongRole) {
    return (
      <UserContext.Provider value={user}>
        <LiveConnection area={area} />
        {children}
      </UserContext.Provider>
    );
  }

  const serverDown = !user && isTemporary(error);
  const waiting = (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center">
      <Spinner label={t(serverDown ? "session.serverDown" : "session.checking")} />
      {serverDown && (
        <Button variant="outline" onClick={() => void refetch()}>
          {t("session.retry")}
        </Button>
      )}
    </div>
  );
  return area === "kiosk" ? <KioskShell>{waiting}</KioskShell> : <AuthShell>{waiting}</AuthShell>;
}
