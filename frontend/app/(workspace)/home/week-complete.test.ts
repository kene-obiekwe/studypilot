import { describe, expect, it } from "vitest";

import type { SessionHistoryItem, WeeklyPlan } from "@/lib/api";

import { completedWeekHours } from "./week-complete";

// Wednesday 28 October 2026, 12:00 local; the week starts Monday 26 October.
const NOW = new Date(2026, 9, 28, 12);

function entry(name: string, plannedHours: number) {
  return {
    course_id: 1,
    name,
    difficulty: 3,
    factor: 1,
    adjustment_source: "none" as const,
    adherence_estimate: null,
    entered_on: "2026-10-26",
    logged_at_revision: 0,
    remaining_at_revision: plannedHours,
    planned_hours: plannedHours,
    focus_block_minutes: 50,
    break_minutes: 10,
  };
}

function plan(entries: Array<[string, number]>): WeeklyPlan {
  const courses = entries.map(([name, hours]) => entry(name, hours));
  return {
    id: 1,
    week_start: "2026-10-26",
    revision: 1,
    revision_count: 1,
    is_current: true,
    superseded_at: null,
    created_at: new Date(2026, 9, 26, 9).toISOString(),
    updated_at: new Date(2026, 9, 26, 9).toISOString(),
    plan_json: {
      version: 2,
      mode: "first",
      made_on: "2026-10-26",
      total_hours: entries.reduce((sum, [, hours]) => sum + hours, 0),
      more_hours: 0,
      counted_hours: 0,
      clamped: false,
      courses,
      removed: [],
      total_available_hours: 0,
      allocations: [],
    },
  };
}

function session(course: string, minutes: number): SessionHistoryItem {
  return {
    id: Math.round(minutes),
    course_name: course,
    planned_minutes: minutes,
    actual_minutes: minutes,
    focus_score: 0.7,
    completion_rate: 0.7,
    adherence_score: 1,
    predicted_adherence: null,
    model_version: "",
    created_at: new Date(2026, 9, 27, 10).toISOString(),
  };
}

describe("completedWeekHours", () => {
  it("is the planned total once every course has reached its hours", () => {
    expect(completedWeekHours([plan([["A", 2], ["B", 1]])], [session("A", 120), session("B", 60)], NOW)).toBe(3);
  });

  it("is null while any course still has hours left", () => {
    expect(completedWeekHours([plan([["A", 2], ["B", 1]])], [session("A", 180)], NOW)).toBeNull();
  });

  it("is null with no plan, or a plan with no hours in it", () => {
    expect(completedWeekHours([], [session("A", 60)], NOW)).toBeNull();
    expect(completedWeekHours([plan([["A", 0]])], [], NOW)).toBeNull();
  });
});
