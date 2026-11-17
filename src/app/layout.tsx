import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Outfit served from the project (spec §4: no Google Fonts dependency in production).
const outfit = localFont({
  src: [
    { path: "../fonts/Outfit-400.woff2", weight: "400" },
    { path: "../fonts/Outfit-500.woff2", weight: "500" },
    { path: "../fonts/Outfit-600.woff2", weight: "600" },
    { path: "../fonts/Outfit-700.woff2", weight: "700" },
  ],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Zira Backoffice", template: "%s · Zira Backoffice" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions inject attributes on <html> (e.g. webcrx) before
    // React hydrates. Only silences attribute diffs on this element, not on its children.
    <html lang="fr" className={outfit.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
