import type { CSSProperties } from "react";

import { Badge, ProgressBar } from "@/components/ui";
import type { PlanResponse } from "@/lib/api";

import { adjustmentText, estimateText, hoursChanged, hoursText, isAdjusted } from "./plan-model";
import styles from "./planner.module.css";

type PlanResultsProps = {
  allocations: PlanResponse["allocations"];
  /** The colour variables for a course name, or undefined for a neutral dot. */
  colorStyle?: (courseName: string) => CSSProperties | undefined;
};

/** One row per course: the hours first, then where any adjustment came from. */
export function PlanResults({ allocations, colorStyle }: PlanResultsProps) {
  const total = allocations.reduce((sum, item) => sum + item.allocated_hours, 0);
  return (
    <ul className={styles.results}>
      {allocations.map((item) => {
        const adjusted = isAdjusted(item);
        const estimate = estimateText(item.adherence_estimate);
        return (
          <li key={item.course} className={styles.result}>
            <div className={styles.resultHead}>
              <p className={styles.resultName}>
                <span className={styles.dot} style={colorStyle?.(item.course)} aria-hidden="true" />
                {item.course}
              </p>
              <p className={styles.resultHours}>
                <span className={styles.hours}>{hoursText(item.allocated_hours)}</span>
                {adjusted && hoursChanged(item) && typeof item.base_hours === "number" && (
                  <span className={styles.base}>from {hoursText(item.base_hours)} by difficulty</span>
                )}
              </p>
            </div>
            <div style={colorStyle?.(item.course)}>
              <ProgressBar
                label={`${item.course} share of the plan`}
                value={item.allocated_hours}
                max={total}
                valueText={`${hoursText(item.allocated_hours)} of ${hoursText(total)}`}
                hideHeader
              />
            </div>
            <p className={styles.facts}>
              <Badge tone={adjusted ? "accent" : "neutral"}>{adjustmentText(item)}</Badge>
              {adjusted && typeof item.adherence_factor === "number" && <span>Weight ×{item.adherence_factor.toFixed(1)}</span>}
              {estimate && <span>{estimate}</span>}
              <span>
                {item.focus_block_minutes}-minute focus blocks, {item.break_minutes}-minute breaks
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
