import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Strategies" };

export default function StrategiesLayout({ children }: { children: ReactNode }) {
  return children;
}
