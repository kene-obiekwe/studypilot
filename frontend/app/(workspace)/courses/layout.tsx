import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Courses" };

export default function CoursesLayout({ children }: { children: ReactNode }) {
  return children;
}
