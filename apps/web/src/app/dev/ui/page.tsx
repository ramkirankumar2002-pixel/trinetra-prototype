// A development tool for looking at the design system. It does not exist in production.
//   /dev/ui                      dashboard components
//   /dev/ui?kiosk=details        a sample weighbridge screen
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KioskSample } from "./kiosk-samples";
import { KIOSK_SCREENS } from "./screens";
import { UiPanel } from "./ui-panel";

export const metadata: Metadata = { title: "Design system (development)" };

export default async function DevUiPage({
  searchParams,
}: {
  searchParams: Promise<{ kiosk?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { kiosk } = await searchParams;
  const screen = KIOSK_SCREENS.find((name) => name === kiosk);
  if (screen) return <KioskSample screen={screen} />;
  return (
    <UiPanel
      kioskLinks={KIOSK_SCREENS.map((name) => (
        <Link key={name} className="underline" href={`/dev/ui?kiosk=${name}`}>
          {name}
        </Link>
      ))}
    />
  );
}
