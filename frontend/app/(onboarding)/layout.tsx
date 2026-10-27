import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { WorkspaceGuard } from "@/components/app-shell";
import { UiRoot } from "@/components/ui";

import styles from "./onboarding.module.css";

export const metadata: Metadata = {
  title: "Set up",
};

/** A focused frame for first-time setup: the wordmark, no navigation. Signed-in visitors only. */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceGuard>
      <UiRoot className={styles.page}>
        <header className={styles.header}>
          <Link href="/home" className={styles.wordmark}>
            StudyPilot
          </Link>
        </header>
        <main id="main-content" className={styles.main}>
          {children}
        </main>
      </UiRoot>
    </WorkspaceGuard>
  );
}
