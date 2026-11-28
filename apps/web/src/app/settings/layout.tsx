import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RequireRole } from "@/components/require-role";
import { LanguageScopeProvider } from "@/i18n/use-t";

export const metadata: Metadata = { title: "Demo settings" };

/** The store officer's login: there is no admin role. The backend checks it too. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <LanguageScopeProvider scope="staff">
      <RequireRole area="store">{children}</RequireRole>
    </LanguageScopeProvider>
  );
}
