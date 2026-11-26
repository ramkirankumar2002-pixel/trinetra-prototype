// A development tool for looking at the design system. It does not exist in production.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UiPanel } from "./ui-panel";

export const metadata: Metadata = { title: "Design system (development)" };

export default async function DevUiPage({
  searchParams,
}: {
  searchParams: Promise<{ layout?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { layout } = await searchParams;
  return <UiPanel layout={layout === "kiosk" ? "kiosk" : "dashboard"} />;
}
