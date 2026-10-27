import "./globals.css";
import "../styles/tokens.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { THEME_INIT_SCRIPT } from "@/lib/theme";

// One sans family for everything. The legacy --font-body / --font-display variables map to it
// in globals.css, so pages not yet redesigned keep working with the new font.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  // Each route sets its own title; the template adds the product name.
  title: { default: "StudyPilot", template: "%s · StudyPilot" },
  description:
    "Split your weekly study hours across your courses, get study techniques for each one, and adjust your plan from the sessions you log.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the inline script before hydration, so React must not warn about it.
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
