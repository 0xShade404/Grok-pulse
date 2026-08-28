import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";
import { SiteHeader } from "@/components/SiteHeader";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "GrokPulse",
  description:
    "Real-time trading terminal for short-duration Polymarket prediction markets.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col bg-bg text-ink antialiased">
        <Providers>
          <SiteHeader />
          <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
          <LegalFooter />
        </Providers>
      </body>
    </html>
  );
}
