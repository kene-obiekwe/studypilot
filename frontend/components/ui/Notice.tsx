import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type NoticeTone = "info" | "success" | "warning" | "danger";

const TONES = {
  info: { className: styles.noticeInfo, Icon: Info },
  success: { className: styles.noticeSuccess, Icon: CircleCheck },
  warning: { className: styles.noticeWarning, Icon: TriangleAlert },
  danger: { className: styles.noticeDanger, Icon: CircleAlert },
} as const;

export type NoticeProps = {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * An inline message. Danger notices are announced immediately (role="alert"); the others
 * politely (role="status"). Render them conditionally so the announcement fires when they appear.
 */
export function Notice({ tone = "info", title, children, className }: NoticeProps) {
  const { className: toneClass, Icon } = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx(styles.notice, toneClass, className)}>
      <span className={styles.noticeIcon} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div>
        {title && <p className={styles.noticeTitle}>{title}</p>}
        {children && <div className={styles.noticeBody}>{children}</div>}
      </div>
    </div>
  );
}
