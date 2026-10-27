/** Pure logic for the planner page: the editable course rows, the request payload and the result wording. */

import type { Course, PlanPayload, PlanResponse } from "@/lib/api";
import { courseKey } from "@/lib/courses";

export const MIN_HOURS = 1;
export const MAX_HOURS = 168;
export const MAX_PLAN_COURSES = 20;
export const DEFAULT_DIFFICULTY = 3;

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

export function newRow(key: string): PlannerRow {
  return { key, courseId: null, name: "", difficulty: DEFAULT_DIFFICULTY };
}

function clampDifficulty(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DIFFICULTY;
  return Math.min(5, Math.max(1, Math.round(value)));
}

/** Rows with a name become plan courses (trimmed, difficulty 1 to 5); blank rows are dropped. */
export function buildPayload(rows: ReadonlyArray<PlannerRow>, totalHours: number): PlanPayload {
  return {
    total_available_hours: totalHours,
    courses: rows
      .filter((row) => row.name.trim())
      .map((row) => ({ name: row.name.trim(), difficulty: clampDifficulty(row.difficulty) })),
  };
}

export type PlanProblems = { hours?: string; courses?: string };

/** Checks the API would also make, so the user hears about them before the request. */
export function validatePlanInput(rows: ReadonlyArray<PlannerRow>, totalHours: number): PlanProblems {
  const problems: PlanProblems = {};
  if (!Number.isFinite(totalHours) || totalHours < MIN_HOURS || totalHours > MAX_HOURS) {
    problems.hours = `Enter a number of hours from ${MIN_HOURS} to ${MAX_HOURS}.`;
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

type PlanAllocation = PlanResponse["allocations"][number];

export function adjustmentText(allocation: Pick<PlanAllocation, "adjustment_source">): string {
  switch (allocation.adjustment_source) {
    case "model":
      return "Adjusted from your forecast";
    case "rule":
      return "Adjusted from your recent adherence";
    default:
      return "No adjustment yet";
  }
}

/** True when the hours differ from the plain difficulty split. */
export function isAdjusted(allocation: Pick<PlanAllocation, "adherence_factor" | "adjustment_source">): boolean {
  return (
    allocation.adjustment_source !== undefined &&
    allocation.adjustment_source !== "none" &&
    typeof allocation.adherence_factor === "number" &&
    allocation.adherence_factor !== 1
  );
}

/** True when the final hours differ from the plain difficulty split by at least 0.05 h. */
export function hoursChanged(allocation: Pick<PlanAllocation, "allocated_hours" | "base_hours">): boolean {
  return typeof allocation.base_hours === "number" && Math.abs(allocation.base_hours - allocation.allocated_hours) >= 0.05;
}

/** "Expected adherence 72%", or null when the plan had nothing to estimate from. */
export function estimateText(estimate: number | null | undefined): string | null {
  if (typeof estimate !== "number" || !Number.isFinite(estimate)) return null;
  return `Expected adherence ${Math.round(Math.min(1, Math.max(0, estimate)) * 100)}%`;
}

/** "6 h", "6.9 h". */
export function hoursText(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} h`;
}

/** The saved course a result row belongs to, matched ignoring case; used for its colour. */
export function findCourseByName<T extends { id: number; name: string }>(courses: ReadonlyArray<T>, name: string): T | undefined {
  const key = courseKey(name);
  return courses.find((course) => courseKey(course.name) === key);
}
