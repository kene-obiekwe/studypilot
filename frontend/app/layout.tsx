import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Study Planner MVP",
  description: "AI-powered personalised study planning and recommendation system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
