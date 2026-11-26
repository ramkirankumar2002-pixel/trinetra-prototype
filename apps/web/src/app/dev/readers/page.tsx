// A development tool for trying the plate and invoice readers. Not in production builds.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReadersPanel } from "./readers-panel";

export const metadata: Metadata = { title: "Readers (development)" };

export default function DevReadersPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ReadersPanel />;
}
