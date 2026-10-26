"use client";

import { useState, type CSSProperties } from "react";

import { Button, Disclosure } from "@/components/ui";
import type { PlanHistoryItem } from "@/lib/api";

import { shortDate } from "./history-model";
import styles from "./progress.module.css";

export const PLANS_PAGE_SIZE = 8;

function hours(value: number | undefined): string {
  if (typeof value !== "number") return "-";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} h`;
}

type PlansListProps = {
  plans: ReadonlyArray<PlanHistoryItem>;
  colorStyle?: (courseName: string) => CSSProperties | undefined;
  pageSize?: number;
};

/** Past plans as compact rows, newest first. Each opens to its per-course hours. */
export function PlansList({ plans, colorStyle, pageSize = PLANS_PAGE_SIZE }: PlansListProps) {
  const [visible, setVisible] = useState(pageSize);
  const shown = plans.slice(0, visible);

  return (
    <div className={styles.section}>
      <ul className={styles.list}>
        {shown.map((plan) => {
          const allocations = plan.plan_json.allocations ?? [];
          const count = allocations.length || (plan.plan_json.courses ?? []).length;
          return (
            <li key={plan.id} className={styles.planRow}>
              <div className={styles.planHead}>
                <p className={styles.rowTitle}>{shortDate(plan.created_at)}</p>
                <p className={styles.rowMeta}>
                  {hours(plan.plan_json.total_available_hours)} planned · {count} {count === 1 ? "course" : "courses"}
                </p>
              </div>
              {allocations.length > 0 && (
                <Disclosure summary={`Show hours by course`}>
                  <ul className={styles.allocations}>
                    {allocations.map((item, index) => (
                      <li key={`${plan.id}-${item.course ?? index}`} className={styles.allocation}>
                        <span className={styles.courseCell}>
                          <span className={styles.dot} style={item.course ? colorStyle?.(item.course) : undefined} aria-hidden="true" />
                          {item.course ?? "Course"}
                        </span>
                        <span>{hours(item.allocated_hours)}</span>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length < plans.length && (
        <div className={styles.more}>
          <p className={styles.muted} role="status">
            Showing {shown.length} of {plans.length} plans
          </p>
          <Button onClick={() => setVisible((count) => count + pageSize)}>Show more</Button>
        </div>
      )}
    </div>
  );
}
