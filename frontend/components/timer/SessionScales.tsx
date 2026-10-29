"use client";

import { SegmentedControl } from "@/components/ui";
import { COMPLETION_STEPS, FOCUS_STEPS } from "@/lib/timer";

import styles from "./timer.module.css";

const FOCUS_OPTIONS = FOCUS_STEPS.map((score, index) => ({ value: String(score), label: String(index + 1) }));
const COMPLETION_OPTIONS = COMPLETION_STEPS.map((rate) => ({ value: String(rate), label: `${rate * 100}%` }));

/** Neutral starting points: the middle step of each scale. */
export const DEFAULT_FOCUS = String(FOCUS_STEPS[2]);
export const DEFAULT_COMPLETION = String(COMPLETION_STEPS[2]);

/** Focus in five steps, stored as 0.2 to 1.0. */
export function FocusScale({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className={styles.scale}>
      <p className={styles.scaleLabel} aria-hidden="true">
        Focus
      </p>
      {/* The end labels take the control's width, so they sit under 1 and 5. */}
      <div className={styles.scaleBody}>
        <SegmentedControl label="Focus, from 1 distracted to 5 fully focused" options={FOCUS_OPTIONS} value={value} onChange={onChange} />
        <p className={styles.scaleEnds} aria-hidden="true">
          <span>1 distracted</span>
          <span>5 fully focused</span>
        </p>
      </div>
    </div>
  );
}

/** Completion in quarters, stored as 0 to 1. */
export function CompletionScale({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className={styles.scale}>
      <p className={styles.scaleLabel} aria-hidden="true">
        How much of what you planned did you finish?
      </p>
      <SegmentedControl
        label="How much of what you planned did you finish?"
        options={COMPLETION_OPTIONS}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
