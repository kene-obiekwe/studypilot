/**
 * "This week" numbers for the sidebar meter and the home page.
 *
 * Days and weeks are decided in the user's zone (the optional trailing `zone`, the browser's when
 * omitted) by comparing YYYY-MM-DD date keys: the week runs from the zone's Monday to now, and the
 * plan for "this week" is the one whose week_start equals that Monday's key (see lib/zone.ts).
 */

import type { PlanHistoryItem, SessionHistoryItem } from "./api";
import { addDays, dateKeyIn, dayStartIn, mondayOf, resolveZone, todayKey, weekdayOf } from "./zone";

export type WeekSummary = {
  /** The week's Monday as YYYY-MM-DD. */
  weekStart: string;
  plannedHours: number;
  loggedHours: number;
};

/** Monday 00:00 of the week containing `now`, in `zone`. */
export function startOfLocalWeek(now: Date, zone?: string): Date {
  const z = resolveZone(zone);
  return dayStartIn(mondayOf(todayKey(z, now)), z);
}

/** YYYY-MM-DD of an instant in `zone` (not toISOString, which is UTC). */
export function localDateKey(date: Date, zone?: string): string {
  return dateKeyIn(date, resolveZone(zone));
}

/** A plan from /planner/plans/ (WeeklyPlan) or a plan in the stored shape (PlanHistoryItem: the version-1 shape kept for plans saved before 5.8b.1, or version 2). */
export type PlanLike = PlanHistoryItem & { revision?: number; is_current?: boolean };

/** One course of a plan, read the same way from a version-1 or a version-2 plan. */
export type PlanEntry = {
  name: string;
  plannedHours: number;
  /** YYYY-MM-DD the course entered the plan; a version-1 plan has no such date, so its week start. */
  enteredOn: string;
  focusBlockMinutes: number | null;
};

const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const finiteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * The plan's courses. Version 2 reads `courses` (planned_hours, entered_on); a version-1 plan reads
 * `allocations` (allocated_hours is the planned hours, and every course entered on the week start).
 */
export function planEntries(plan: PlanLike | undefined): PlanEntry[] {
  if (!plan) return [];
  const { courses, allocations } = plan.plan_json;
  const planned = (courses ?? []).filter((course) => typeof course.name === "string" && finiteNonNegative(course.planned_hours));
  if (planned.length > 0) {
    return planned.map((course) => ({
      name: course.name!,
      plannedHours: course.planned_hours!,
      enteredOn: course.entered_on ?? plan.week_start,
      focusBlockMinutes: finitePositive(course.focus_block_minutes) ? course.focus_block_minutes : null,
    }));
  }
  return (allocations ?? [])
    .filter((allocation) => typeof allocation.course === "string" && allocation.course && finitePositive(allocation.allocated_hours))
    .map((allocation) => ({
      name: allocation.course!,
      plannedHours: allocation.allocated_hours!,
      enteredOn: plan.week_start,
      focusBlockMinutes: finitePositive(allocation.focus_block_minutes) ? allocation.focus_block_minutes : null,
    }));
}

/** Monday of the week `weeks` after (or before) the one containing `now`, in `zone`, as YYYY-MM-DD. */
export function weekStartKey(now: Date, weeks = 0, zone?: string): string {
  return addDays(mondayOf(todayKey(resolveZone(zone), now)), 7 * weeks);
}

/** The plan to use for the week starting `weekStart` (YYYY-MM-DD): its current revision, else its newest. */
export function currentPlanForWeek<T extends PlanLike>(plans: readonly T[], weekStart: string): T | undefined {
  return plans
    .filter((plan) => plan.week_start === weekStart)
    .sort(
      (a, b) =>
        Number(b.is_current ?? false) - Number(a.is_current ?? false) ||
        (b.revision ?? 0) - (a.revision ?? 0) ||
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        b.id - a.id,
    )[0];
}

/** The current plan for this week, if any. */
export function currentPlanThisWeek<T extends PlanLike>(plans: readonly T[], now: Date, zone?: string): T | undefined {
  return currentPlanForWeek(plans, weekStartKey(now, 0, zone));
}

/** The week's total: a version-2 plan's total_hours, else (version 1) the sum of its allocations. 0 with no plan. */
export function plannedHoursThisWeek(plans: readonly PlanLike[], now: Date, zone?: string): number {
  const plan = currentPlanThisWeek(plans, now, zone);
  if (!plan) return 0;
  const total = plan.plan_json.total_hours;
  if (finiteNonNegative(total)) return total;
  return planEntries(plan).reduce((sum, entry) => sum + entry.plannedHours, 0);
}

/**
 * A test for "logged this week so far": an instant (ms) counts when it is no later than `now` and
 * its date in `zone` is on or after this week's Monday. Date keys are compared, not a Monday 00:00
 * instant, so a 167 or 169 hour DST week needs no special case.
 */
export function weekSoFar(now: Date, zone?: string): (at: number) => boolean {
  const z = resolveZone(zone);
  const monday = mondayOf(todayKey(z, now));
  const to = now.getTime();
  return (at) => Number.isFinite(at) && at <= to && dateKeyIn(at, z) >= monday;
}

function sumHours(sessions: readonly SessionHistoryItem[], now: Date, zone?: string): number {
  const inWeek = weekSoFar(now, zone);
  const minutes = sessions.reduce((sum, session) => {
    const actual = Number(session.actual_minutes);
    return inWeek(Date.parse(session.created_at)) && Number.isFinite(actual) && actual > 0 ? sum + actual : sum;
  }, 0);
  return minutes / 60;
}

/**
 * Hours logged from this week's Monday up to now. With a plan for this week in `plans`, only the
 * courses in that plan count (logs on removed or never-planned courses stay in history but are not
 * counted); with no plan, everything counts.
 */
export function loggedHoursThisWeek(
  sessions: readonly SessionHistoryItem[],
  now: Date,
  plans: readonly PlanLike[] = [],
  zone?: string,
): number {
  const entries = planEntries(currentPlanThisWeek(plans, now, zone));
  if (entries.length === 0) return sumHours(sessions, now, zone);
  const names = new Set(entries.map((entry) => entry.name.trim().toLowerCase()));
  return sumHours(
    sessions.filter((session) => names.has((session.course_name ?? "").trim().toLowerCase())),
    now,
    zone,
  );
}

export function summariseWeek(
  plans: readonly PlanLike[],
  sessions: readonly SessionHistoryItem[],
  now: Date,
  zone?: string,
): WeekSummary {
  return {
    weekStart: weekStartKey(now, 0, zone),
    plannedHours: plannedHoursThisWeek(plans, now, zone),
    loggedHours: loggedHoursThisWeek(sessions, now, plans, zone),
  };
}

export type DaysLeft = {
  /** Days left in the week including today: 7 on Monday, 1 on Sunday. */
  count: number;
  /** "Wed–Sun"; a single day is just "Sun". */
  label: string;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function daysLeft(now: Date, zone?: string): DaysLeft {
  const weekday = weekdayOf(todayKey(resolveZone(zone), now)); // Monday = 0
  const count = 7 - weekday;
  return { count, label: count === 1 ? "Sun" : `${DAY_NAMES[weekday]}–Sun` };
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

const sameName = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/** True when there is a plan for this week. */
export function hasPlanThisWeek(plans: readonly PlanLike[], now: Date, zone?: string): boolean {
  return currentPlanThisWeek(plans, now, zone) !== undefined;
}

/** True when next week already has a plan (made ahead on a Saturday or Sunday). */
export function hasPlanNextWeek(plans: readonly PlanLike[], now: Date, zone?: string): boolean {
  return currentPlanForWeek(plans, weekStartKey(now, 1, zone)) !== undefined;
}

export type CourseWeekStatus = "in_plan" | "done" | "removed" | "not_in_plan";

export type CourseWeekHours = {
  /** Hours logged on the course this week (also for a course that is not counted). */
  logged: number;
  /** The course's planned hours this week; null unless it is in the plan. */
  planned: number | null;
  /** Hours still to do, never below 0; null unless it is in the plan. */
  remaining: number | null;
  /**
   * in_plan: planned hours left. done: planned hours reached (or nothing planned). removed: taken out
   * of this week's plan. not_in_plan: no plan, or the plan never had the course.
   */
  status: CourseWeekStatus;
};

/** Below this many hours (about a second) a remainder is rounding noise, not time left. */
const REMAINING_EPSILON = 1e-6;

/**
 * One course's hours this week. Logs match the course by name, case-insensitively, as the backend
 * stores them. `remaining` is live: planned minus what is logged now, never below 0.
 */
export function courseHoursThisWeek(
  courseName: string,
  plans: readonly PlanLike[],
  sessions: readonly SessionHistoryItem[],
  now: Date,
  zone?: string,
): CourseWeekHours {
  const plan = currentPlanThisWeek(plans, now, zone);
  const logged = sumHours(
    sessions.filter((session) => sameName(session.course_name, courseName)),
    now,
    zone,
  );
  const entry = planEntries(plan).find((item) => sameName(item.name, courseName));
  if (entry) {
    const remaining = Math.max(0, entry.plannedHours - logged);
    const left = remaining > REMAINING_EPSILON ? remaining : 0;
    return { logged, planned: entry.plannedHours, remaining: left, status: left > 0 ? "in_plan" : "done" };
  }
  const removed = (plan?.plan_json.removed ?? []).some((item) => sameName(item.name, courseName));
  return { logged, planned: null, remaining: null, status: removed ? "removed" : "not_in_plan" };
}

export type StripSegment = { courseId: number | null; courseName: string; minutes: number };

export type StripDay = {
  /** YYYY-MM-DD, in the week's zone. */
  date: string;
  /** "Mon" … "Sun". */
  label: string;
  isToday: boolean;
  minutes: number;
  /** Minutes per course, in the order of `courses`; logs for a deleted or renamed course come last as "Other". */
  segments: StripSegment[];
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday to Sunday of this week, with the minutes logged each day split by course. */
export function weekStrip(
  sessions: SessionHistoryItem[],
  courses: ReadonlyArray<{ id: number; name: string }>,
  now: Date,
  zone?: string,
): StripDay[] {
  const z = resolveZone(zone);
  const today = todayKey(z, now);
  const monday = mondayOf(today);
  const days = DAY_LABELS.map((label, index) => ({ date: addDays(monday, index), label, totals: new Map<number | null, number>() }));
  const byDate = new Map(days.map((day) => [day.date, day]));

  for (const session of sessions) {
    const at = Date.parse(session.created_at);
    const minutes = Number(session.actual_minutes);
    if (!Number.isFinite(at) || !Number.isFinite(minutes) || minutes <= 0) continue;
    const day = byDate.get(dateKeyIn(at, z));
    if (!day) continue;
    const course = courses.find((item) => sameName(session.course_name, item.name));
    const key = course ? course.id : null;
    day.totals.set(key, (day.totals.get(key) ?? 0) + minutes);
  }

  return days.map(({ date, label, totals }) => {
    const segments: StripSegment[] = courses
      .filter((course) => totals.has(course.id))
      .map((course) => ({ courseId: course.id, courseName: course.name, minutes: totals.get(course.id)! }));
    if (totals.has(null)) segments.push({ courseId: null, courseName: "Other", minutes: totals.get(null)! });
    return {
      date,
      label,
      isToday: date === today,
      minutes: segments.reduce((sum, segment) => sum + segment.minutes, 0),
      segments,
    };
  });
}

/** "1h 25m", "45m": for tight spots such as the week strip's columns. */
export function formatMinutesShort(minutes: number): string {
  const total = Math.round(Math.max(0, minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "1 h 25 min", "45 min", "0 min". */
export function formatMinutes(minutes: number): string {
  const total = Math.round(Math.max(0, minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
