import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Forecast" };

export default function ProgressForecastLayout({ children }: { children: ReactNode }) {
  return children;
}
