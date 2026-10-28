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

/** A plan from /planner/plans/ (WeeklyPlan) or the history alias (PlanHistoryItem, version 1 or 2). */
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

/** Monday of the local week `weeks` after (or before) the one containing `now`, as YYYY-MM-DD. */
export function weekStartKey(now: Date, weeks = 0): string {
  const monday = startOfLocalWeek(now);
  return localDateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7 * weeks));
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

/** The current plan for this local week, if any. */
export function currentPlanThisWeek<T extends PlanLike>(plans: readonly T[], now: Date): T | undefined {
  return currentPlanForWeek(plans, weekStartKey(now));
}

/** The week's total: a version-2 plan's total_hours, else (version 1) the sum of its allocations. 0 with no plan. */
export function plannedHoursThisWeek(plans: readonly PlanLike[], now: Date): number {
  const plan = currentPlanThisWeek(plans, now);
  if (!plan) return 0;
  const total = plan.plan_json.total_hours;
  if (finiteNonNegative(total)) return total;
  return planEntries(plan).reduce((sum, entry) => sum + entry.plannedHours, 0);
}

function sumHours(sessions: readonly SessionHistoryItem[], now: Date): number {
  const from = startOfLocalWeek(now).getTime();
  const to = now.getTime();
  const minutes = sessions.reduce((sum, session) => {
    const at = Date.parse(session.created_at);
    const actual = Number(session.actual_minutes);
    return at >= from && at <= to && Number.isFinite(actual) && actual > 0 ? sum + actual : sum;
  }, 0);
  return minutes / 60;
}

/**
 * Hours logged from local Monday 00:00 up to now. With a plan for this week in `plans`, only the
 * courses in that plan count (logs on removed or never-planned courses stay in history but are not
 * counted); with no plan, everything counts.
 */
export function loggedHoursThisWeek(sessions: readonly SessionHistoryItem[], now: Date, plans: readonly PlanLike[] = []): number {
  const entries = planEntries(currentPlanThisWeek(plans, now));
  if (entries.length === 0) return sumHours(sessions, now);
  const names = new Set(entries.map((entry) => entry.name.trim().toLowerCase()));
  return sumHours(
    sessions.filter((session) => names.has((session.course_name ?? "").trim().toLowerCase())),
    now,
  );
}

export function summariseWeek(plans: readonly PlanLike[], sessions: readonly SessionHistoryItem[], now: Date): WeekSummary {
  return {
    weekStart: localDateKey(startOfLocalWeek(now)),
    plannedHours: plannedHoursThisWeek(plans, now),
    loggedHours: loggedHoursThisWeek(sessions, now, plans),
  };
}

export type DaysLeft = {
  /** Days left in the local week including today: 7 on Monday, 1 on Sunday. */
  count: number;
  /** "Wed–Sun"; a single day is just "Sun". */
  label: string;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function daysLeft(now: Date): DaysLeft {
  const weekday = (now.getDay() + 6) % 7; // Monday = 0
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

/** True when there is a plan for this local week. */
export function hasPlanThisWeek(plans: readonly PlanLike[], now: Date): boolean {
  return currentPlanThisWeek(plans, now) !== undefined;
}

/** True when next week already has a plan (made ahead on a Saturday or Sunday). */
export function hasPlanNextWeek(plans: readonly PlanLike[], now: Date): boolean {
  return currentPlanForWeek(plans, weekStartKey(now, 1)) !== undefined;
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
): CourseWeekHours {
  const plan = currentPlanThisWeek(plans, now);
  const logged = sumHours(
    sessions.filter((session) => sameName(session.course_name, courseName)),
    now,
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
  /** YYYY-MM-DD, local. */
  date: string;
  /** "Mon" … "Sun". */
  label: string;
  isToday: boolean;
  minutes: number;
  /** Minutes per course, in the order of `courses`; logs for a deleted or renamed course come last as "Other". */
  segments: StripSegment[];
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday to Sunday of this local week, with the minutes logged each day split by course. */
export function weekStrip(
  sessions: SessionHistoryItem[],
  courses: ReadonlyArray<{ id: number; name: string }>,
  now: Date,
): StripDay[] {
  const monday = startOfLocalWeek(now);
  const today = localDateKey(now);
  const days = DAY_LABELS.map((label, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    return { date: localDateKey(date), label, totals: new Map<number | null, number>() };
  });
  const byDate = new Map(days.map((day) => [day.date, day]));

  for (const session of sessions) {
    const at = Date.parse(session.created_at);
    const minutes = Number(session.actual_minutes);
    if (!Number.isFinite(at) || !Number.isFinite(minutes) || minutes <= 0) continue;
    const day = byDate.get(localDateKey(new Date(at)));
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
