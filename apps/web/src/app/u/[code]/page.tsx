import type { Metadata } from "next";
import { LanguageScopeProvider } from "@/i18n/use-t";
import { UploadPage } from "./upload-page";

// The address holds the one-time code: it is not passed on or listed anywhere.
export const metadata: Metadata = {
  title: "Send invoice",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    // The phone speaks the language the driver chose at the weighbridge.
    <LanguageScopeProvider scope="kiosk">
      <UploadPage code={code} />
    </LanguageScopeProvider>
  );
}
