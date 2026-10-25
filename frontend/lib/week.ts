/**
 * "This week" numbers for the sidebar meter and the home page.
 *
 * Everything here uses the browser's LOCAL time: the week runs from Monday 00:00 local to now,
 * and the plan for "this week" is the one whose week_start equals the local Monday's date.
 * Known limitation: the backend stamps StudyPlan.week_start with its own TIME_ZONE (UTC), so
 * for a user far from UTC a plan saved around Sunday/Monday midnight can carry the neighbouring
 * Monday for a few hours. The fix belongs server-side (per-user time zone).
 */

import type { PlanHistoryItem, SessionHistoryItem } from "./api";

export type WeekSummary = {
  /** Local Monday as YYYY-MM-DD. */
  weekStart: string;
  plannedHours: number;
  loggedHours: number;
};

/** Monday 00:00 of the week containing `now`, local time. */
export function startOfLocalWeek(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7; // getDay(): Sunday = 0
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

/** YYYY-MM-DD of a date in local time (not toISOString, which is UTC). */
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Hours in the latest plan for this local week; 0 when there is none. */
export function plannedHoursThisWeek(plans: PlanHistoryItem[], now: Date): number {
  const monday = localDateKey(startOfLocalWeek(now));
  const latest = plans
    .filter((plan) => plan.week_start === monday)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
  if (!latest) return 0;
  return (latest.plan_json.allocations ?? []).reduce((sum, allocation) => {
    const hours = Number(allocation.allocated_hours);
    return Number.isFinite(hours) && hours > 0 ? sum + hours : sum;
  }, 0);
}

/** Actual minutes logged from local Monday 00:00 up to now, in hours. */
export function loggedHoursThisWeek(sessions: SessionHistoryItem[], now: Date): number {
  const from = startOfLocalWeek(now).getTime();
  const to = now.getTime();
  const minutes = sessions.reduce((sum, session) => {
    const at = Date.parse(session.created_at);
    const actual = Number(session.actual_minutes);
    return at >= from && at <= to && Number.isFinite(actual) && actual > 0 ? sum + actual : sum;
  }, 0);
  return minutes / 60;
}

export function summariseWeek(plans: PlanHistoryItem[], sessions: SessionHistoryItem[], now: Date): WeekSummary {
  return {
    weekStart: localDateKey(startOfLocalWeek(now)),
    plannedHours: plannedHoursThisWeek(plans, now),
    loggedHours: loggedHoursThisWeek(sessions, now),
  };
}

/** One decimal, no trailing ".0": 7.5 -> "7.5", 12 -> "12", 0.04 -> "0". */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "This week: 7.5 of 12 h", or a plan-less variant. */
export function meterText(summary: Pick<WeekSummary, "plannedHours" | "loggedHours">): string {
  const logged = formatHours(summary.loggedHours);
  return summary.plannedHours > 0 ? `${logged} of ${formatHours(summary.plannedHours)} h` : `${logged} h logged, no plan yet`;
}
