import { describe, expect, it } from "vitest";

import type { PlanHistoryItem, SessionHistoryItem } from "./api";
import {
  formatHours,
  localDateKey,
  loggedHoursThisWeek,
  meterText,
  plannedHoursThisWeek,
  startOfLocalWeek,
  summariseWeek,
} from "./week";

// Local-time constructors keep these tests correct in any time zone the suite runs in.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (date: Date) => date.toISOString();

function plan(id: number, weekStart: string, createdAt: Date, hours: number[]): PlanHistoryItem {
  return {
    id,
    week_start: weekStart,
    created_at: iso(createdAt),
    plan_json: { allocations: hours.map((h, i) => ({ course: `C${i}`, allocated_hours: h })) },
  };
}

function session(createdAt: Date, actualMinutes: number): SessionHistoryItem {
  return {
    id: Math.floor(createdAt.getTime() / 1000),
    course_name: "Calculus",
    planned_minutes: 60,
    actual_minutes: actualMinutes,
    focus_score: 0.7,
    completion_rate: 0.7,
    adherence_score: 0.7,
    predicted_adherence: null,
    model_version: "",
    created_at: iso(createdAt),
  };
}

// Wednesday 22 October 2026, 15:00 local.
const NOW = at(2026, 10, 22, 15);

describe("local week boundaries", () => {
  it("starts on Monday 00:00 local", () => {
    const start = startOfLocalWeek(NOW);
    expect(localDateKey(start)).toBe("2026-10-19");
    expect([start.getHours(), start.getMinutes()]).toEqual([0, 0]);
  });

  it("treats Sunday as the last day of the week and Monday as the first", () => {
    expect(localDateKey(startOfLocalWeek(at(2026, 10, 25, 23, 59)))).toBe("2026-10-19");
    expect(localDateKey(startOfLocalWeek(at(2026, 10, 26, 0, 0)))).toBe("2026-10-26");
  });

  it("crosses month and year boundaries", () => {
    expect(localDateKey(startOfLocalWeek(at(2026, 11, 1)))).toBe("2026-10-26");
    expect(localDateKey(startOfLocalWeek(at(2027, 1, 1)))).toBe("2026-12-28");
  });

  it("formats dates in local time, not UTC", () => {
    expect(localDateKey(at(2026, 3, 5, 0, 30))).toBe("2026-03-05");
  });
});

describe("planned hours", () => {
  it("sums the latest plan for this week", () => {
    const plans = [
      plan(1, "2026-10-19", at(2026, 10, 19, 9), [3, 4]),
      plan(2, "2026-10-19", at(2026, 10, 21, 9), [5, 4.5, 2.5]),
      plan(3, "2026-10-12", at(2026, 10, 22, 9), [40]),
    ];
    expect(plannedHoursThisWeek(plans, NOW)).toBe(12);
  });

  it("is 0 without a plan for this week", () => {
    expect(plannedHoursThisWeek([], NOW)).toBe(0);
    expect(plannedHoursThisWeek([plan(1, "2026-10-12", at(2026, 10, 12), [9])], NOW)).toBe(0);
  });

  it("ignores missing or invalid allocation hours", () => {
    const odd = plan(1, "2026-10-19", at(2026, 10, 20), [2]);
    odd.plan_json.allocations?.push({ course: "X" }, { course: "Y", allocated_hours: Number.NaN }, { course: "Z", allocated_hours: -3 });
    expect(plannedHoursThisWeek([odd], NOW)).toBe(2);
  });
});

describe("logged hours", () => {
  it("counts actual minutes from Monday 00:00 up to now", () => {
    const sessions = [
      session(at(2026, 10, 19, 0, 0), 30), // Monday midnight: counts
      session(at(2026, 10, 21, 18), 90), // Tuesday evening: counts
      session(at(2026, 10, 22, 14, 59), 60), // earlier today: counts
      session(at(2026, 10, 18, 23, 59), 120), // Sunday before: previous week
      session(at(2026, 10, 22, 16), 45), // after "now": not yet
    ];
    expect(loggedHoursThisWeek(sessions, NOW)).toBe(3);
  });

  it("ignores negative or non-numeric minutes", () => {
    expect(loggedHoursThisWeek([session(at(2026, 10, 20), -30), session(at(2026, 10, 20), Number.NaN)], NOW)).toBe(0);
  });
});

describe("summary and text", () => {
  it("combines both numbers for the local week", () => {
    const summary = summariseWeek([plan(1, "2026-10-19", at(2026, 10, 19), [12])], [session(at(2026, 10, 20), 450)], NOW);
    expect(summary).toEqual({ weekStart: "2026-10-19", plannedHours: 12, loggedHours: 7.5 });
    expect(meterText(summary)).toBe("7.5 of 12 h");
  });

  it("says when there is no plan yet", () => {
    expect(meterText({ plannedHours: 0, loggedHours: 1.25 })).toBe("1.3 h logged, no plan yet");
  });

  it("formats hours with at most one decimal", () => {
    expect([formatHours(7.5), formatHours(12), formatHours(0.04), formatHours(2.96)]).toEqual(["7.5", "12", "0", "3"]);
  });
});
