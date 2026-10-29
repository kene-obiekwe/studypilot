import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article";
  padding?: "none" | "sm" | "md";
};

/** A bordered surface. Use sparingly: hierarchy comes from spacing first, then rows, then cards. */
export function Card({ as: Tag = "div", padding = "md", className, ...props }: CardProps) {
  const pad = { none: styles.cardPadNone, sm: styles.cardPadSm, md: styles.cardPadMd }[padding];
  return <Tag {...props} className={cx(styles.card, pad, className)} />;
}

/** A bordered list for dense rows (courses, sessions, history). */
export function List({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul {...props} className={cx(styles.list, className)} />;
}

export type ListRowProps = Omit<HTMLAttributes<HTMLLIElement>, "title"> & {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
};

export function ListRow({ leading, title, description, trailing, className, ...props }: ListRowProps) {
  return (
    <li {...props} className={cx(styles.row, className)}>
      <span className={styles.rowLeading}>{leading}</span>
      <div className={styles.rowBody}>
        <p className={styles.rowTitle}>{title}</p>
        {description && <p className={styles.rowDescription}>{description}</p>}
      </div>
      <span className={styles.rowTrailing}>{trailing}</span>
    </li>
  );
}
