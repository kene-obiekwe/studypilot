/** Sorting and wording for the history table. Pure, so it can be tested without a DOM. */

import type { SessionHistoryItem } from "@/lib/api";

export type SortKey = "date" | "course" | "planned" | "actual" | "adherence" | "focus" | "forecast";
export type SortDirection = "asc" | "desc";
export type SortState = { key: SortKey; direction: SortDirection };

export const DEFAULT_SORT: SortState = { key: "date", direction: "desc" };

export const SORT_LABELS: Record<SortKey, string> = {
  date: "Date",
  course: "Course",
  planned: "Planned",
  actual: "Actual",
  adherence: "Adherence",
  focus: "Focus",
  forecast: "Forecast",
};

export const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[];

/** A new column starts with its natural order: A to Z for course, biggest or newest first for numbers. */
function firstDirection(key: SortKey): SortDirection {
  return key === "course" ? "asc" : "desc";
}

/** Sorting by a column from scratch, in its natural order. */
export function startSort(key: SortKey): SortState {
  return { key, direction: firstDirection(key) };
}

/** Clicking the sorted column flips its direction; clicking another column sorts by it. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return startSort(key);
}

export function ariaSort(state: SortState, key: SortKey): "ascending" | "descending" | "none" {
  if (state.key !== key) return "none";
  return state.direction === "asc" ? "ascending" : "descending";
}

function value(item: SessionHistoryItem, key: SortKey): number | string | null {
  switch (key) {
    case "date":
      return Date.parse(item.created_at) || 0;
    case "course":
      return item.course_name.trim().toLowerCase();
    case "planned":
      return item.planned_minutes;
    case "actual":
      return item.actual_minutes;
    case "adherence":
      return item.adherence_score;
    case "focus":
      return item.focus_score;
    case "forecast":
      return typeof item.predicted_adherence === "number" ? item.predicted_adherence : null;
  }
}

/**
 * Sorted copy of the sessions. Sessions with no forecast always sit last, whatever the direction;
 * ties fall back to the newest session first so the order never jumps around.
 */
export function sortSessions(items: ReadonlyArray<SessionHistoryItem>, state: SortState): SessionHistoryItem[] {
  const sign = state.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = value(a, state.key);
    const right = value(b, state.key);
    if (left === null || right === null) {
      if (left === right) return b.id - a.id;
      return left === null ? 1 : -1;
    }
    const order = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : (left as number) - (right as number);
    return order !== 0 ? order * sign : b.id - a.id;
  });
}

/** "5 Mar 2026": UK order whatever the browser's locale, like the rest of the app. The day is the one in `zone`. */
export function shortDate(value: string, zone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: zone });
}

/** "82%" from a 0 to 1 score, or "n/a" when there is none. */
export function percentText(score: number | null | undefined): string {
  return typeof score === "number" && Number.isFinite(score) ? `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%` : "n/a";
}
