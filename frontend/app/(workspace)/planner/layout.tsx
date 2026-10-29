import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Planner" };

export default function PlannerLayout({ children }: { children: ReactNode }) {
  return children;
}
