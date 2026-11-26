import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LanguageScopeProvider } from "@/i18n/use-t";

export const metadata: Metadata = { title: "Store officer" };

export default function StoreLayout({ children }: { children: ReactNode }) {
  return <LanguageScopeProvider scope="staff">{children}</LanguageScopeProvider>;
}
