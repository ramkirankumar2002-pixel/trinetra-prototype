import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LanguageScopeProvider } from "@/i18n/use-t";

export const metadata: Metadata = { title: "Supervisor" };

export default function SupervisorLayout({ children }: { children: ReactNode }) {
  return <LanguageScopeProvider scope="staff">{children}</LanguageScopeProvider>;
}
