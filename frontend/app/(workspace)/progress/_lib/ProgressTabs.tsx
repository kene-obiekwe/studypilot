"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./progress.module.css";

const TABS = [
  { href: "/progress", label: "Overview" },
  { href: "/progress/log", label: "Log" },
  { href: "/progress/history", label: "History" },
  { href: "/progress/predict", label: "Forecast" },
] as const;

/** The active tab: Overview only on /progress itself, the others on their own path. */
export function activeTab(pathname: string | null | undefined): string | undefined {
  const path = (pathname ?? "").replace(/\/+$/, "") || "/";
  if (path === "/progress") return "/progress";
  return TABS.find((tab) => tab.href !== "/progress" && (path === tab.href || path.startsWith(`${tab.href}/`)))?.href;
}

/** Sections of the Progress area. The current one carries aria-current="page". */
export function ProgressTabs() {
  const active = activeTab(usePathname());
  return (
    <nav className={styles.tabs} aria-label="Progress sections">
      {TABS.map(({ href, label }) => (
        <Link key={href} href={href} className={styles.tab} aria-current={href === active ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
