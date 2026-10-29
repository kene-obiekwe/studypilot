import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type DisclosureProps = {
  /** The toggle text, "Why?" by default. */
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

/** A small "Why?" expander on native <details>: keyboard and screen-reader support built in. */
export function Disclosure({ summary = "Why?", children, defaultOpen = false, className }: DisclosureProps) {
  return (
    <details className={cx(styles.disclosure, className)} open={defaultOpen || undefined}>
      <summary className={cx(styles.disclosureSummary, styles.focusable)}>
        <ChevronRight size={14} className={styles.disclosureChevron} aria-hidden="true" />
        {summary}
      </summary>
      <div className={styles.disclosureContent}>{children}</div>
    </details>
  );
}
