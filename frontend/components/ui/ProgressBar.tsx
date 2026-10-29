import { useId } from "react";

import { courseColor } from "../../lib/course-colors";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type ProgressBarProps = {
  /** Visible label, also the bar's accessible name. */
  label: string;
  value: number;
  max: number;
  /** What a screen reader hears and the header shows, e.g. "2.1 of 3.5 h". Defaults to a percentage. */
  valueText?: string;
  /** Fill in this course's colour; otherwise the accent. */
  courseId?: number;
  /** Hide the visible header (the label stays as the accessible name). */
  hideHeader?: boolean;
  className?: string;
};

export function ProgressBar({ label, value, max, valueText, courseId, hideHeader = false, className }: ProgressBarProps) {
  const labelId = useId();
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  const text = valueText ?? `${Math.round(percent)}%`;
  return (
    <div className={cx(styles.progress, className)} style={courseId !== undefined ? courseColor(courseId).style : undefined}>
      <div className={hideHeader ? styles.srOnly : styles.progressHeader}>
        <span id={labelId} className={styles.progressLabel}>
          {label}
        </span>
        <span className={styles.progressValue} aria-hidden="true">
          {text}
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
        aria-valuetext={text}
        className={styles.progressTrack}
      >
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
