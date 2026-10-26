import { describe, expect, it } from "vitest";

import type { PlanHistoryItem, SessionHistoryItem } from "./api";
import {
  courseHoursThisWeek,
  formatHours,
  formatMinutes,
  formatMinutesShort,
  hasPlanThisWeek,
  localDateKey,
  loggedHoursThisWeek,
  meterText,
  plannedHoursThisWeek,
  startOfLocalWeek,
  summariseWeek,
  weekStrip,
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

// Thursday 22 October 2026, 15:00 local.
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

describe("week strip", () => {
  const courses = [
    { id: 3, name: "Calculus" },
    { id: 9, name: "HIS 210" },
  ];
  const log = (courseName: string, when: Date, minutes: number): SessionHistoryItem => ({ ...session(when, minutes), course_name: courseName });

  it("covers Monday to Sunday with today marked", () => {
    const days = weekStrip([], courses, NOW);
    expect(days.map((day) => day.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days[0].date).toBe("2026-10-19");
    expect(days[6].date).toBe("2026-10-25");
    expect(days.filter((day) => day.isToday).map((day) => day.label)).toEqual(["Thu"]);
    expect(days.every((day) => day.minutes === 0 && day.segments.length === 0)).toBe(true);
  });

  it("sums minutes per day and course, in course order, with unknown courses as Other", () => {
    const days = weekStrip(
      [
        log("HIS 210", at(2026, 10, 20, 9), 30),
        log("calculus", at(2026, 10, 20, 10), 45), // case-insensitive, like the backend
        log("Calculus", at(2026, 10, 20, 23, 30), 15),
        log("Deleted course", at(2026, 10, 20, 11), 20),
        log("Calculus", at(2026, 10, 18, 12), 60), // last Sunday: not this week
        log("Calculus", at(2026, 10, 22, 8), 0), // zero minutes: skipped
      ],
      courses,
      NOW,
    );
    const tuesday = days[1];
    expect(tuesday.minutes).toBe(110);
    expect(tuesday.segments).toEqual([
      { courseId: 3, courseName: "Calculus", minutes: 60 },
      { courseId: 9, courseName: "HIS 210", minutes: 30 },
      { courseId: null, courseName: "Other", minutes: 20 },
    ]);
    expect(days.reduce((sum, day) => sum + day.minutes, 0)).toBe(110);
  });

  it("formats minutes", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(85)).toBe("1 h 25 min");
    expect(formatMinutesShort(45)).toBe("45m");
    expect(formatMinutesShort(120)).toBe("2h");
    expect(formatMinutesShort(65)).toBe("1h 5m");
  });
});

describe("per-course hours", () => {
  const plans = [plan(1, "2026-10-19", at(2026, 10, 19, 8), [3.5, 2])]; // courses C0 and C1

  it("matches the plan allocation and logged sessions by name", () => {
    const sessions = [
      { ...session(at(2026, 10, 20), 90), course_name: "c0" },
      { ...session(at(2026, 10, 21), 30), course_name: "C1" },
    ];
    expect(courseHoursThisWeek("C0", plans, sessions, NOW)).toEqual({ loggedHours: 1.5, plannedHours: 3.5 });
    expect(courseHoursThisWeek("Elsewhere", plans, sessions, NOW)).toEqual({ loggedHours: 0, plannedHours: null });
  });

  it("knows whether this week has a plan", () => {
    expect(hasPlanThisWeek(plans, NOW)).toBe(true);
    expect(hasPlanThisWeek(plans, at(2026, 10, 27))).toBe(false);
  });
});
