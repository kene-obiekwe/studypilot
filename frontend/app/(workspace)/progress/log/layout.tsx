import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Log a session" };

export default function ProgressLogLayout({ children }: { children: ReactNode }) {
  return children;
}
