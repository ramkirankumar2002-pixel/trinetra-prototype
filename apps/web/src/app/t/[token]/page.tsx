import type { Metadata } from "next";
import { PublicTicketPage } from "@/components/public-ticket/ticket-page";
import { LanguageScopeProvider } from "@/i18n/use-t";

// The address is the key to this ticket: it is not passed on to other sites or listed.
export const metadata: Metadata = {
  title: "Ticket",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <LanguageScopeProvider scope="staff">
      <PublicTicketPage token={token} />
    </LanguageScopeProvider>
  );
}
