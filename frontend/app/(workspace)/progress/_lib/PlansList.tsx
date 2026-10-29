"use client";

import type { CSSProperties } from "react";

import { Button, Disclosure } from "@/components/ui";
import { formatHours, planEntries, type PlanLike } from "@/lib/week";

import styles from "./progress.module.css";
import { useShowMore } from "./use-show-more";

export const PLANS_PAGE_SIZE = 8;

/** A plan row's data: the weekly plan from /planner/plans/ (with revision_count) or a first-version history item. */
export type PlanRowData = PlanLike & { revision_count?: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Week of 26 Oct" for a plan's Monday (YYYY-MM-DD). */
export function weekTitle(weekStart: string): string {
  const [, month, day] = weekStart.split("-").map(Number);
  if (!month || !day) return "Week";
  return `Week of ${day} ${MONTHS[month - 1]}`;
}

/** "updated 2 times": how many times the plan was changed after its first version. Empty for a plan never updated. */
function updatedText(plan: PlanRowData): string {
  const updates = (plan.revision_count ?? 1) - 1;
  if (updates <= 0) return "";
  return `updated ${updates} ${updates === 1 ? "time" : "times"}`;
}

function planTotal(plan: PlanRowData): number {
  const total = plan.plan_json.total_hours;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  return planEntries(plan).reduce((sum, entry) => sum + entry.plannedHours, 0);
}

type PlanWeekRowProps = {
  plan: PlanRowData;
  colorStyle?: (courseName: string) => CSSProperties | undefined;
};

/** One week's plan: "Week of 26 Oct", its hours, courses and updates; it opens to per-course hours and any removed courses. */
export function PlanWeekRow({ plan, colorStyle }: PlanWeekRowProps) {
  const entries = planEntries(plan);
  const removed = (plan.plan_json.removed ?? []).filter((item) => typeof item.name === "string" && item.name);
  const meta = [
    `${formatHours(planTotal(plan))} h`,
    `${entries.length} ${entries.length === 1 ? "course" : "courses"}`,
    updatedText(plan),
  ].filter(Boolean);

  return (
    <li className={styles.planRow}>
      <div className={styles.planHead}>
        <p className={styles.rowTitle}>{weekTitle(plan.week_start)}</p>
        <p className={styles.rowMeta}>{meta.join(" · ")}</p>
      </div>
      {(entries.length > 0 || removed.length > 0) && (
        <Disclosure summary="Show hours by course">
          <ul className={styles.allocations}>
            {entries.map((entry) => (
              <li key={`${plan.id}-${entry.name}`} className={styles.allocation}>
                <span className={styles.courseCell}>
                  <span className={styles.dot} style={colorStyle?.(entry.name)} aria-hidden="true" />
                  {entry.name}
                </span>
                <span>{formatHours(entry.plannedHours)} h</span>
              </li>
            ))}
          </ul>
          {removed.length > 0 && (
            <p className={styles.muted}>
              No longer in this week&rsquo;s plan:{" "}
              {removed.map((item) => `${item.name} · ${formatHours(item.logged_hours ?? 0)} h logged (not counted)`).join("; ")}
            </p>
          )}
        </Disclosure>
      )}
    </li>
  );
}

type PlansListProps = {
  plans: ReadonlyArray<PlanRowData>;
  colorStyle?: (courseName: string) => CSSProperties | undefined;
  pageSize?: number;
};

/** One row per week, newest first. Each opens to its per-course hours. */
export function PlansList({ plans, colorStyle, pageSize = PLANS_PAGE_SIZE }: PlansListProps) {
  const { visible, done, showMore, statusRef } = useShowMore(plans.length, pageSize);
  const shown = plans.slice(0, visible);

  return (
    <div className={styles.section}>
      <ul className={styles.list}>
        {shown.map((plan) => (
          <PlanWeekRow key={plan.id} plan={plan} colorStyle={colorStyle} />
        ))}
      </ul>
      {plans.length > pageSize && (
        <div className={styles.more}>
          <p ref={statusRef} tabIndex={-1} className={`${styles.muted} ${styles.moreStatus}`} role="status">
            Showing {shown.length} of {plans.length} plans
          </p>
          {!done && <Button onClick={showMore}>Show more</Button>}
        </div>
      )}
    </div>
  );
}
