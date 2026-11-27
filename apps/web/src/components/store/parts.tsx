"use client";

// Small parts the store officer's pages share.
import { formatIST, type ApprovalView } from "@trinetra/shared";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { kindPill, statusShown } from "@/lib/store/logic";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Spinner } from "../ui/spinner";
import { StatusPill } from "../ui/status-pill";
import type { TicketStatus } from "@trinetra/shared";

export function KindPill({ approval }: { approval: ApprovalView }) {
  const t = useT();
  const { tone, key } = kindPill(approval);
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

export function TicketStatusPill({
  status,
  cancelled = false,
}: {
  status: TicketStatus;
  cancelled?: boolean;
}) {
  const t = useT();
  const { tone, key } = statusShown(status, cancelled);
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

/** "14:05" in India. */
export const timeOf = (iso: string) => formatIST(new Date(iso)).split(", ")[1]!.replace(" IST", "");

/** Names and values, in two columns where there is room. Empty values are left out. */
export function Facts({ facts }: { facts: [MessageKey, ReactNode | null | undefined][] }) {
  const t = useT();
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {facts.map(([label, value]) =>
        value === null || value === undefined || value === "" ? null : (
          <div key={label} className="flex min-w-0 flex-col">
            <dt className="text-sm text-muted-foreground">{t(label)}</dt>
            <dd className="font-semibold break-words">{value}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

export function Loading() {
  const t = useT();
  return <Spinner label={t("sup.loading")} className="py-10" />;
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <Banner tone="stop">
        <span role="alert">{t("sup.loadFailed")}</span>
      </Banner>
      <Button size="lg" variant="outline" onClick={onRetry}>
        {t("session.retry")}
      </Button>
    </div>
  );
}

export function BackLink({
  href,
  label,
  primary = false,
}: {
  href: string;
  label: MessageKey;
  primary?: boolean;
}) {
  const t = useT();
  return (
    <Button asChild size="lg" variant={primary ? "primary" : "outline"}>
      <Link href={href}>
        <ArrowLeft aria-hidden />
        {t(label)}
      </Link>
    </Button>
  );
}

/** A card on its own: waiting for the server, or the page that could not be had. */
export function PageState({ children }: { children: ReactNode }) {
  return <Card>{children}</Card>;
}
