import type { ReactNode } from "react";

import { cx } from "./cx";
import styles from "./ui.module.css";

export type StatProps = {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  className?: string;
};

/** Numbers first: a label above a big tabular number, e.g. "This week" / "7.5 of 12 h". */
export function Stat({ label, value, unit, hint, className }: StatProps) {
  return (
    <div className={cx(styles.stat, className)}>
      <span className={styles.statLabel}>{label}</span>
      <p className={styles.statValue}>
        {value}
        {unit && <span className={styles.statUnit}>{unit}</span>}
      </p>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  );
}
