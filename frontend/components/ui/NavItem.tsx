import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type NavItemProps = {
  href: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  /** "sidebar": a row with a left accent bar when active. "tab": a bottom-tab-bar cell with a top bar. */
  layout?: "sidebar" | "tab";
  className?: string;
};

export function NavItem({ href, label, icon, active = false, layout = "sidebar", className }: NavItemProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(styles.nav, styles.focusable, layout === "sidebar" ? styles.navSidebar : styles.navTab, className)}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span>{label}</span>
    </Link>
  );
}
