import Link from "next/link";
import type { ReactNode } from "react";

import { Card, UiRoot } from "@/components/ui";

import styles from "./_components/auth.module.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <UiRoot className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark}>
          StudyPilot
        </Link>
      </header>
      <main className={styles.main}>
        <Card padding="md">{children}</Card>
      </main>
      <footer className={styles.footer}>
        <Link href="/" className={styles.footerLink}>
          Back to the home page
        </Link>
      </footer>
    </UiRoot>
  );
}
