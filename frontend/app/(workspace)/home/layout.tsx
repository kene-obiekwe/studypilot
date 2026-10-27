import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "This week" };

export default function HomeLayout({ children }: { children: ReactNode }) {
  return children;
}
