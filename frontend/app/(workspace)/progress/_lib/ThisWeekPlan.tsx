"use client";

import type { CSSProperties } from "react";

import type { WeeklyPlan } from "@/lib/api";
import { currentPlanForWeek, weekStartKey } from "@/lib/week";

import { dayLabel, hoursText, planTotal } from "../../planner/plan-model";
import { PlanWeekRow } from "./PlansList";
import styles from "./progress.module.css";

type Props = {
  plans: ReadonlyArray<WeeklyPlan>;
  now: Date;
  colorStyle?: (courseName: string) => CSSProperties | undefined;
};

/**
 * This week's plan, not the newest one (that is next week's once it exists). A line below says when
 * next week's plan is already made.
 */
export function ThisWeekPlan({ plans, now, colorStyle }: Props) {
  const thisWeek = currentPlanForWeek(plans, weekStartKey(now));
  const nextWeek = currentPlanForWeek(plans, weekStartKey(now, 1));
  const nextWeekLine = nextWeek && (
    <p className={styles.muted}>
      Next week&rsquo;s plan: {hoursText(planTotal(nextWeek))}, starts {dayLabel(nextWeek.week_start)}
    </p>
  );

  if (!thisWeek) {
    return (
      <>
        <p className={styles.muted}>
          {plans.length === 0 ? "No plans yet. Make one in the planner." : "No plan for this week yet. Make one in the planner."}
        </p>
        {nextWeekLine}
      </>
    );
  }
  return (
    <>
      <ul className={styles.list}>
        <PlanWeekRow plan={thisWeek} colorStyle={colorStyle} />
      </ul>
      {nextWeekLine}
    </>
  );
}
