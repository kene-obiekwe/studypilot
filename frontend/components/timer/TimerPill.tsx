"use client";

import { Timer } from "lucide-react";

import { describeElapsed, elapsedMs, formatElapsed, type TimerState } from "@/lib/timer";
import { useNow } from "@/lib/timer-store";

import { useActiveTimer, useTimerActions } from "./TimerProvider";
import styles from "./timer.module.css";

/** Shown in the top bar while a timer runs: course and elapsed time; opens "How did it go?". */
export function TimerPill() {
  const timer = useActiveTimer();
  return timer ? <RunningPill timer={timer} /> : null;
}

function RunningPill({ timer }: { timer: TimerState }) {
  const { openStop } = useTimerActions();
  const elapsed = elapsedMs(timer, useNow());
  return (
    <button
      type="button"
      className={styles.pill}
      onClick={openStop}
      aria-label={`Timer for ${timer.courseName}, ${describeElapsed(elapsed)}. Stop timer`}
    >
      <Timer size={16} aria-hidden="true" className={styles.pillIcon} />
      <span className={styles.pillCourse} aria-hidden="true">
        {timer.courseName}
      </span>
      <span className={styles.pillTime} aria-hidden="true">
        {formatElapsed(elapsed)}
      </span>
    </button>
  );
}

/** The live elapsed time for inline use (e.g. a course card). */
export function ElapsedTime({ timer }: { timer: TimerState }) {
  const elapsed = elapsedMs(timer, useNow());
  return (
    <>
      <span aria-hidden="true">{formatElapsed(elapsed)}</span>
      <span className={styles.srOnly}>{describeElapsed(elapsed)}</span>
    </>
  );
}
