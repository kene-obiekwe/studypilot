import { Check } from "lucide-react";

import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/onboarding";

import styles from "../onboarding.module.css";

/** Courses · Plan · First session. The current step carries aria-current; finished ones say so to screen readers. */
export function StepIndicator({ step }: { step: OnboardingStep }) {
  return (
    <nav aria-label="Setup progress">
      <ol className={styles.steps}>
        {ONBOARDING_STEPS.map(({ step: number, label }) => {
          const done = number < step;
          return (
            <li
              key={number}
              className={`${styles.stepItem} ${done ? styles.stepDone : ""}`}
              aria-current={number === step ? "step" : undefined}
            >
              <span className={styles.stepMark} aria-hidden="true">
                {done ? <Check size={14} /> : number}
              </span>
              {label}
              {done && <span className={styles.srOnly}> (done)</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
