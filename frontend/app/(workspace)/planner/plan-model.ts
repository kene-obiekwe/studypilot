/**
 * Pure logic for the planner page: which week is being planned and how (a first plan or an update),
 * the editable course rows, the request, and the wording of the week card and the preview.
 */

import type {
  Course,
  PlanCourseEntry,
  PlanCourseInput,
  PlanPreview,
  SessionHistoryItem,
  WeeklyPlan,
  WeeklyPlanDetail,
  WeeklyPlanInput,
} from "@/lib/api";
import { courseKey } from "@/lib/courses";
import { courseHoursThisWeek, formatHours, loggedHoursThisWeek, planEntries, weekStartKey, type PlanLike } from "@/lib/week";

export const MIN_HOURS = 1;
export const MAX_HOURS = 168;
export const MAX_PLAN_COURSES = 20;
export const DEFAULT_DIFFICULTY = 3;
/** The weekly total a first plan starts from when there is nothing to copy. */
export const DEFAULT_TOTAL_HOURS = 12;

// -- Weeks ---------------------------------------------------------------------------------------

/** "this": the week containing today. "next": the one after, planned ahead on a Saturday or Sunday. */
export type WeekTarget = "this" | "next";

/** Monday = 0 … Sunday = 6, local time. */
export function weekdayIndex(now: Date): number {
  return (now.getDay() + 6) % 7;
}

export const isSaturday = (now: Date) => weekdayIndex(now) === 5;
export const isSunday = (now: Date) => weekdayIndex(now) === 6;

/** Next week can be planned ahead on Saturday and Sunday only. */
export const canPlanAhead = (now: Date) => weekdayIndex(now) >= 5;

/** On Sunday the planner offers next week first (this week ends today); otherwise this week. */
export function defaultTarget(now: Date): WeekTarget {
  return isSunday(now) ? "next" : "this";
}

/** The Monday (YYYY-MM-DD) of the week being planned. */
export function targetWeekStart(now: Date, target: WeekTarget): string {
  return weekStartKey(now, target === "next" ? 1 : 0);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Wed 28 Oct" for a YYYY-MM-DD date (read as a local date, not UTC). */
export function dayLabel(key: string): string {
  const [year, month, day] = key.slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return key;
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

/** "5 days left this week, Wed–Sun"; "1 day left this week, Sun". */
export function daysLeftText(days: { count: number; label: string }): string {
  return `${days.count} ${days.count === 1 ? "day" : "days"} left this week, ${days.label}`;
}

// -- Hours ---------------------------------------------------------------------------------------

/** "6 h", "6.9 h". */
export function hoursText(hours: number): string {
  return `${formatHours(hours)} h`;
}

/** Hours to the hundredth, as the server keeps them. */
export function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

/** The value an hours input starts with: "6", "6.25". */
export function hoursInput(hours: number): string {
  return String(roundHours(hours));
}

/** A plan's total: total_hours when the plan has it, else (first-version plans) the sum of its courses. */
export function planTotal(plan: PlanLike): number {
  const total = plan.plan_json.total_hours;
  if (typeof total === "number" && Number.isFinite(total) && total >= 0) return total;
  return planEntries(plan).reduce((sum, entry) => sum + entry.plannedHours, 0);
}

/**
 * The weekly total the user last chose. Deleting a course shrinks the plan without asking (a
 * "course_deleted" revision), so those revisions are skipped: their hours are there to share out.
 */
export function chosenTotal(plan: WeeklyPlan | WeeklyPlanDetail): number {
  const older = "revisions" in plan && plan.revisions ? [...plan.revisions].sort((a, b) => b.revision - a.revision) : [];
  const chosen = [plan, ...older].find((revision) => revision.plan_json.mode !== "course_deleted") ?? plan;
  return planTotal(chosen);
}

/** Hours logged this local week on the courses named in the rows (each course once). */
export function loggedOnRows(rows: ReadonlyArray<PlannerRow>, sessions: readonly SessionHistoryItem[], now: Date): number {
  const names = new Map(rows.filter((row) => row.name.trim()).map((row) => [courseKey(row.name), row.name]));
  return [...names.values()].reduce((sum, name) => sum + courseHoursThisWeek(name, [], sessions, now).logged, 0);
}

/** "How many more hours?" starts at the chosen total less what is already done, never below 0. */
export function defaultMoreHours(chosen: number, counted: number): number {
  return roundHours(Math.max(0, chosen - counted));
}

// -- Course rows ---------------------------------------------------------------------------------

export type PlannerRow = {
  /** Stable key for React and for editing; not sent to the API. */
  key: string;
  /** The saved course this row came from, or null for a name typed in on this page. */
  courseId: number | null;
  name: string;
  difficulty: number;
};

export function rowsFromCourses(courses: ReadonlyArray<Course>): PlannerRow[] {
  return courses.map((course) => ({
    key: `course-${course.id}`,
    courseId: course.id,
    name: course.name,
    difficulty: course.difficulty,
  }));
}

/** The saved course a name belongs to, matched ignoring case and spacing. */
export function findCourseByName<T extends { id: number; name: string }>(courses: ReadonlyArray<T>, name: string): T | undefined {
  const key = courseKey(name);
  return courses.find((course) => courseKey(course.name) === key);
}

/** The plan's courses as rows, with the difficulty the plan used (else the saved one). */
export function rowsFromPlan(plan: PlanLike, courses: ReadonlyArray<Course>): PlannerRow[] {
  const difficulties = new Map((plan.plan_json.courses ?? []).map((entry) => [courseKey(entry.name ?? ""), entry.difficulty]));
  return planEntries(plan).map((entry, index) => {
    const saved = findCourseByName(courses, entry.name);
    const difficulty = difficulties.get(courseKey(entry.name)) ?? saved?.difficulty ?? DEFAULT_DIFFICULTY;
    return {
      key: saved ? `course-${saved.id}` : `plan-${index}`,
      courseId: saved?.id ?? null,
      name: saved?.name ?? entry.name,
      difficulty: clampDifficulty(difficulty),
    };
  });
}

export function newRow(key: string): PlannerRow {
  return { key, courseId: null, name: "", difficulty: DEFAULT_DIFFICULTY };
}

function clampDifficulty(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DIFFICULTY;
  return Math.min(5, Math.max(1, Math.round(value)));
}

/** A first plan pre-filled from an earlier week; nothing is saved until the preview is confirmed. */
export type PlanDraft = { totalHours: number; rows: PlannerRow[] };

/** Last week's plan as a draft: its total and the courses that still exist, or null when none do. */
export function draftFromPlan(plan: PlanLike, courses: ReadonlyArray<Course>): PlanDraft | null {
  const rows = rowsFromPlan(plan, courses).filter((row) => row.courseId !== null);
  if (rows.length === 0) return null;
  return { totalHours: Math.min(MAX_HOURS, Math.max(MIN_HOURS, roundHours(planTotal(plan)))), rows };
}

/** "12 h, 3 courses". */
export function draftSummary(draft: PlanDraft): string {
  const count = draft.rows.length;
  return `${hoursText(draft.totalHours)}, ${count} ${count === 1 ? "course" : "courses"}`;
}

/** Rows with a name become plan courses (trimmed, difficulty 1 to 5); blank rows are dropped. */
export function planCourses(rows: ReadonlyArray<PlannerRow>): PlanCourseInput[] {
  return rows
    .filter((row) => row.name.trim())
    .map((row) => ({ name: row.name.trim(), difficulty: clampDifficulty(row.difficulty) }));
}

/**
 * The request: a first plan (no base revision) sends the weekly total; an update sends how many
 * more hours, with the revision it was opened at.
 */
export function buildInput(rows: ReadonlyArray<PlannerRow>, hours: number, baseRevision: number | null): WeeklyPlanInput {
  const courses = planCourses(rows);
  return baseRevision === null
    ? { courses, total_hours: hours, base_revision: null }
    : { courses, more_hours: hours, base_revision: baseRevision };
}

/**
 * After a 409 the week's plan is someone else's newer revision (or a plan now exists): the same
 * request against `baseRevision`. A total turns into "more" by taking off what is already done.
 */
export function rebaseInput(input: WeeklyPlanInput, baseRevision: number | null, counted: number): WeeklyPlanInput {
  if (baseRevision === null) {
    const total = "total_hours" in input ? input.total_hours : input.more_hours + counted;
    return { courses: input.courses, total_hours: Math.min(MAX_HOURS, Math.max(MIN_HOURS, roundHours(total))), base_revision: null };
  }
  const more = "more_hours" in input ? input.more_hours : defaultMoreHours(input.total_hours, counted);
  return { courses: input.courses, more_hours: more, base_revision: baseRevision };
}

export type PlanProblems = { hours?: string; courses?: string };

/**
 * Checks the API would also make, so the user hears about them before the request. A first plan
 * takes a total from 1 to 168; an update takes more hours from 0, up to what the week can still hold.
 */
export function validatePlanInput(
  rows: ReadonlyArray<PlannerRow>,
  hours: number,
  mode: "total" | "more" = "total",
  counted = 0,
): PlanProblems {
  const problems: PlanProblems = {};
  if (mode === "total") {
    if (!Number.isFinite(hours) || hours < MIN_HOURS || hours > MAX_HOURS) {
      problems.hours = `Enter a number of hours from ${MIN_HOURS} to ${MAX_HOURS}.`;
    }
  } else {
    const most = Math.max(0, Math.floor((MAX_HOURS - counted) * 100) / 100);
    if (!Number.isFinite(hours) || hours < 0 || hours > most) {
      problems.hours = `Enter a number of hours from 0 to ${formatHours(most)}.`;
    }
  }
  const named = rows.filter((row) => row.name.trim());
  if (named.length === 0) {
    problems.courses = "Add at least one course to plan.";
  } else if (named.length > MAX_PLAN_COURSES) {
    problems.courses = `A plan can include up to ${MAX_PLAN_COURSES} courses.`;
  } else {
    const seen = new Set<string>();
    for (const row of named) {
      const key = courseKey(row.name);
      if (seen.has(key)) {
        problems.courses = `"${row.name.trim()}" is listed twice. Keep one row for each course.`;
        break;
      }
      seen.add(key);
    }
  }
  return problems;
}

// -- This week's card ----------------------------------------------------------------------------

export type CardRowStatus = "in_plan" | "done" | "none_planned";

export type CardRow = { name: string; logged: number; planned: number; remaining: number; status: CardRowStatus };

export type WeekCard = {
  total: number;
  /** Hours logged this week on the plan's courses (removed courses don't count). */
  logged: number;
  rows: CardRow[];
  /** Courses taken out of the plan this week, with what was logged on them (not counted). */
  removed: Array<{ name: string; logged: number }>;
  /** Every course has reached its planned hours. */
  complete: boolean;
  /** Revisions after the first one. */
  updates: number;
  /** "Wed 28 Oct": the day of the current revision. */
  lastUpdated: string;
};

/** This week's numbers, live: logged and remaining come from the sessions, planned from the plan. */
export function weekCard(plan: WeeklyPlan, sessions: readonly SessionHistoryItem[], now: Date): WeekCard {
  const plans = [plan];
  const rows = planEntries(plan).map((entry): CardRow => {
    const hours = courseHoursThisWeek(entry.name, plans, sessions, now);
    const remaining = hours.remaining ?? 0;
    const status: CardRowStatus =
      hours.status === "in_plan" ? "in_plan" : entry.plannedHours === 0 && hours.logged === 0 ? "none_planned" : "done";
    return { name: entry.name, logged: hours.logged, planned: entry.plannedHours, remaining, status };
  });
  const inPlan = new Set(rows.map((row) => courseKey(row.name)));
  const removed = (plan.plan_json.removed ?? [])
    .filter((item) => item.name && !inPlan.has(courseKey(item.name)))
    .map((item) => ({ name: item.name, logged: courseHoursThisWeek(item.name, plans, sessions, now).logged }));
  const total = planTotal(plan);
  return {
    total,
    logged: loggedHoursThisWeek(sessions, now, plans),
    rows,
    removed,
    complete: total > 0 && rows.length > 0 && rows.every((row) => row.status !== "in_plan"),
    updates: Math.max(0, plan.revision_count - 1),
    lastUpdated: dayLabel(plan.plan_json.made_on ?? plan.created_at),
  };
}

/** "Updated 2 times · last Wed 28 Oct", or null for a plan that was never updated. */
export function updatesText(card: Pick<WeekCard, "updates" | "lastUpdated">): string | null {
  if (card.updates === 0) return null;
  const times = card.updates === 1 ? "once" : `${card.updates} times`;
  return `Updated ${times} · last ${card.lastUpdated}`;
}

/** "B" / "B and C" / "B, C and D". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// -- A course deleted mid-week -------------------------------------------------------------------

/** Courses deleted on /courses since the user last changed the plan; hoursLeft null when unknown. */
export type DeletedCourses = { names: string[]; hoursLeft: number | null };

/**
 * When the current revision came from deleting courses (mode "course_deleted"), which courses went
 * and the hours they still had: each deletion revision is compared with the one before it.
 */
export function deletedCourses(plan: WeeklyPlanDetail): DeletedCourses | null {
  if (plan.plan_json.mode !== "course_deleted") return null;
  const chain: WeeklyPlan[] = [plan, ...[...(plan.revisions ?? [])].sort((a, b) => b.revision - a.revision)];
  const names: string[] = [];
  let hoursLeft: number | null = 0;
  for (let index = 0; index < chain.length && chain[index].plan_json.mode === "course_deleted"; index += 1) {
    const revision = chain[index];
    const before = chain[index + 1];
    if (!before) {
      // The earlier revision wasn't sent: name the courses removed that day, without hours.
      for (const item of revision.plan_json.removed ?? []) {
        if (item.removed_on === revision.plan_json.made_on && !names.includes(item.name)) names.unshift(item.name);
      }
      hoursLeft = null;
      break;
    }
    const kept = new Set(planEntries(revision).map((entry) => courseKey(entry.name)));
    for (const entry of planEntries(before)) {
      if (kept.has(courseKey(entry.name))) continue;
      const removed = (revision.plan_json.removed ?? []).find((item) => courseKey(item.name ?? "") === courseKey(entry.name));
      names.unshift(entry.name);
      if (hoursLeft !== null) hoursLeft += Math.max(0, entry.plannedHours - (removed?.logged_hours ?? 0));
    }
  }
  if (names.length === 0) return null;
  return { names, hoursLeft: hoursLeft === null ? null : roundHours(hoursLeft) };
}

export function deletedCoursesText({ names, hoursLeft }: DeletedCourses): string {
  const list = joinNames(names);
  const several = names.length > 1;
  if (hoursLeft === 0) {
    return `You removed ${list} from your courses. ${several ? "They" : "It"} had no hours left this week.`;
  }
  const hours = hoursLeft === null ? "hours" : hoursText(hoursLeft);
  return `You removed ${list} from your courses, so ${several ? "their" : "its"} ${hours} left this week were dropped. Update the plan to share them out.`;
}

// -- Preview -------------------------------------------------------------------------------------

export type PreviewRow = {
  name: string;
  /** Hours already logged this week (they count towards the plan). */
  done: number;
  /** The course's new planned hours: done + left. */
  planned: number;
  left: number;
  /** Not in the plan being updated. */
  isNew: boolean;
  /** Where an adherence adjustment came from, or null when the plain difficulty split stands. */
  adjustment: string | null;
};

export type PreviewModel = {
  rows: PreviewRow[];
  removed: Array<{ name: string; logged: number }>;
  total: number;
  counted: number;
  more: number;
  /** Courses that already have more than their share, so they get no more hours. */
  pastShare: string[];
  clamped: boolean;
};

export function adjustmentText(entry: Pick<PlanCourseEntry, "adjustment_source">): string {
  switch (entry.adjustment_source) {
    case "model":
      return "Adjusted from your forecast";
    case "rule":
      return "Adjusted from your recent adherence";
    default:
      return "No adjustment yet";
  }
}

/** True when the course's weight differs from the plain difficulty split. */
export function isAdjusted(entry: Pick<PlanCourseEntry, "adjustment_source" | "factor">): boolean {
  return entry.adjustment_source !== "none" && typeof entry.factor === "number" && entry.factor !== 1;
}

/**
 * The preview table. `base` is the plan being updated (null for a first plan): a course not in it
 * is new, and one that left it is listed as removed. Removed courses from earlier in the week are
 * listed when they have hours that no longer count.
 */
export function previewModel(preview: PlanPreview, base: PlanLike | null): PreviewModel {
  const { plan_json: plan } = preview;
  const before = base ? new Set(planEntries(base).map((entry) => courseKey(entry.name))) : null;
  const rows = plan.courses.map((entry) => ({
    name: entry.name,
    done: entry.logged_at_revision,
    planned: entry.planned_hours,
    left: entry.remaining_at_revision,
    isNew: before !== null && !before.has(courseKey(entry.name)),
    adjustment: isAdjusted(entry) ? adjustmentText(entry) : null,
  }));
  const kept = new Set(rows.map((row) => courseKey(row.name)));
  const leaving = new Set([...(before ?? [])].filter((key) => !kept.has(key)));
  const removed = plan.removed
    .filter((item) => item.logged_hours > 0 || leaving.has(courseKey(item.name)))
    .map((item) => ({ name: item.name, logged: item.logged_hours }));
  const more = plan.more_hours;
  return {
    rows,
    removed,
    total: plan.total_hours,
    counted: plan.counted_hours,
    more,
    pastShare: more > 0 ? rows.filter((row) => row.left === 0 && row.done > 0).map((row) => row.name) : [],
    clamped: preview.clamped || plan.clamped,
  };
}

/** "A is already past its share; it gets no more hours this week." */
export function pastShareText(names: readonly string[]): string {
  return names.length > 1
    ? `${joinNames(names)} are already past their share; they get no more hours this week.`
    : `${names[0]} is already past its share; it gets no more hours this week.`;
}

/** "New total 14 h (4 done + 10 more)". */
export function newTotalText(model: Pick<PreviewModel, "total" | "counted" | "more">): string {
  return `New total ${hoursText(model.total)} (${formatHours(model.counted)} done + ${formatHours(model.more)} more)`;
}

/** "You've already done 5 h, so the total stays at 5 h." */
export function clampedText(counted: number): string {
  return `You've already done ${hoursText(counted)}, so the total stays at ${hoursText(counted)}.`;
}
