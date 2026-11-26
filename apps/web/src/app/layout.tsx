import type { Metadata } from "next";
// Fonts come from npm so the kiosk does not depend on Google Fonts on a weak network.
import "@fontsource-variable/noto-sans";
import "@fontsource-variable/noto-sans-devanagari";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trinetra Systems",
  description: "Smart weighbridge prototype",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
