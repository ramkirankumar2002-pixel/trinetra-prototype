import { APP_NAME } from "@trinetra/shared";
import type { Metadata } from "next";
// Fonts come from npm so the kiosk does not depend on Google Fonts on a weak network.
import "@fontsource-variable/noto-sans";
import "@fontsource-variable/noto-sans-devanagari";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Smart weighbridge prototype",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
