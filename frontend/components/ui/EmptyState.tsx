import type { ReactNode } from "react";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type EmptyStateProps = {
  title: ReactNode;
  /** One line on what to do next. */
  description?: ReactNode;
  /** Usually one Button. */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, className)}>
      {icon && (
        <span className={styles.emptyIcon} aria-hidden="true">
          {icon}
        </span>
      )}
      <p className={styles.emptyTitle}>{title}</p>
      {description && <p className={styles.emptyText}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}
