"use client";

import { ProgressBar, Skeleton } from "@/components/ui";
import { formatHours, meterText } from "@/lib/week";

import { useShellData } from "./ShellData";
import styles from "./shell.module.css";

/** "This week: 7.5 of 12 h". Reads shell data, so render it inside a Suspense boundary. */
export function WeekMeter() {
  const { week, excludedHours } = useShellData();
  if (!week) {
    return <p className={styles.meterCaption}>This week&rsquo;s hours are unavailable right now.</p>;
  }
  const text = meterText(week);
  return (
    <div className={styles.meter}>
      <ProgressBar label="This week" value={week.loggedHours} max={week.plannedHours} valueText={text} />
      {week.plannedHours === 0 && <p className={styles.meterCaption}>No plan for this week yet.</p>}
      {week.plannedHours > 0 && formatHours(excludedHours) !== "0" && (
        <p className={styles.meterCaption}>
          Excludes {formatHours(excludedHours)} h on courses no longer in this week&rsquo;s plan.
        </p>
      )}
    </div>
  );
}

export function WeekMeterSkeleton() {
  return (
    <div className={styles.meter} aria-busy="true" aria-label="Loading this week's hours">
      <Skeleton width="60%" height={12} />
      <Skeleton height={8} radius="pill" />
    </div>
  );
}
