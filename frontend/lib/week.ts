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
  const latest = latestPlanThisWeek(plans, now);
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

const sameName = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/** The newest plan saved for this local week, if any. */
export function latestPlanThisWeek(plans: PlanHistoryItem[], now: Date): PlanHistoryItem | undefined {
  const monday = localDateKey(startOfLocalWeek(now));
  return plans
    .filter((plan) => plan.week_start === monday)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
}

/** True when there is a plan for this local week. */
export function hasPlanThisWeek(plans: PlanHistoryItem[], now: Date): boolean {
  return latestPlanThisWeek(plans, now) !== undefined;
}

/**
 * One course's hours this week: logged (matched by name, case-insensitively, as the backend
 * stores logs under the course's name) and planned (null when this week's plan leaves it out).
 */
export function courseHoursThisWeek(
  courseName: string,
  plans: PlanHistoryItem[],
  sessions: SessionHistoryItem[],
  now: Date,
): { loggedHours: number; plannedHours: number | null } {
  const allocation = latestPlanThisWeek(plans, now)?.plan_json.allocations?.find((item) => sameName(item.course, courseName));
  const planned = Number(allocation?.allocated_hours);
  return {
    loggedHours: loggedHoursThisWeek(
      sessions.filter((session) => sameName(session.course_name, courseName)),
      now,
    ),
    plannedHours: allocation && Number.isFinite(planned) && planned > 0 ? planned : null,
  };
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
