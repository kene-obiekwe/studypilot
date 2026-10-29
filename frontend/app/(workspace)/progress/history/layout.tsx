import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "History" };

export default function ProgressHistoryLayout({ children }: { children: ReactNode }) {
  return children;
}
