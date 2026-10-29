import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpLayout({ children }: { children: ReactNode }) {
  return children;
}
