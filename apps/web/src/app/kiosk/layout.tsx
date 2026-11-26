import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LanguageScopeProvider } from "@/i18n/use-t";

export const metadata: Metadata = { title: "Weighbridge" };

export default function KioskLayout({ children }: { children: ReactNode }) {
  return <LanguageScopeProvider scope="kiosk">{children}</LanguageScopeProvider>;
}
