// A development tool for watching the live events. It does not exist in production builds.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LivePanel } from "./live-panel";

export const metadata: Metadata = { title: "Live events (development)" };

export default function DevLivePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LivePanel />;
}
