import { describe, expect, it } from "vitest";

import type { PlanHistoryItem, SessionHistoryItem } from "./api";
import {
  courseHoursThisWeek,
  currentPlanForWeek,
  daysLeft,
  formatHours,
  formatMinutes,
  formatMinutesShort,
  hasPlanNextWeek,
  hasPlanThisWeek,
  localDateKey,
  loggedHoursThisWeek,
  meterText,
  plannedHoursThisWeek,
  startOfLocalWeek,
  summariseWeek,
  weekStartKey,
  weekStrip,
  type PlanLike,
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
    const summary = summariseWeek([plan(1, "2026-10-19", at(2026, 10, 19), [12])], [{ ...session(at(2026, 10, 20), 450), course_name: "C0" }], NOW);
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
    expect(courseHoursThisWeek("C0", plans, sessions, NOW)).toEqual({ logged: 1.5, planned: 3.5, remaining: 2, status: "in_plan" });
    expect(courseHoursThisWeek("Elsewhere", plans, sessions, NOW)).toEqual({
      logged: 0,
      planned: null,
      remaining: null,
      status: "not_in_plan",
    });
  });

  it("knows whether this week has a plan", () => {
    expect(hasPlanThisWeek(plans, NOW)).toBe(true);
    expect(hasPlanThisWeek(plans, at(2026, 10, 27))).toBe(false);
  });
});

// -- version-2 plans (revisions) -------------------------------------------------------------

type V2Course = { name: string; planned: number; logged?: number; enteredOn?: string };

function planV2(
  weekStart: string,
  courses: V2Course[],
  extra: { revision?: number; isCurrent?: boolean; removed?: Array<{ name: string; logged: number }>; id?: number; createdAt?: Date } = {},
): PlanLike {
  const total = courses.reduce((sum, course) => sum + course.planned, 0);
  return {
    id: extra.id ?? 1,
    week_start: weekStart,
    created_at: iso(extra.createdAt ?? at(2026, 10, 19, 9)),
    revision: extra.revision ?? 1,
    is_current: extra.isCurrent ?? true,
    plan_json: {
      version: 2,
      total_hours: total,
      courses: courses.map((course, index) => ({
        course_id: index + 1,
        name: course.name,
        difficulty: 3,
        planned_hours: course.planned,
        logged_at_revision: course.logged ?? 0,
        remaining_at_revision: course.planned - (course.logged ?? 0),
        entered_on: course.enteredOn ?? weekStart,
        focus_block_minutes: 50,
      })),
      removed: (extra.removed ?? []).map((item, index) => ({
        course_id: 90 + index,
        name: item.name,
        removed_on: "2026-10-22",
        logged_hours: item.logged,
      })),
      allocations: courses.map((course) => ({ course: course.name, allocated_hours: course.planned })),
    },
  };
}

const named = (courseName: string, when: Date, minutes: number): SessionHistoryItem => ({ ...session(when, minutes), course_name: courseName });

describe("current plan for a week", () => {
  it("prefers the current revision over newer superseded ones", () => {
    const old = planV2("2026-10-19", [{ name: "A", planned: 7 }], { id: 1, revision: 1, isCurrent: false, createdAt: at(2026, 10, 22, 9) });
    const current = planV2("2026-10-19", [{ name: "A", planned: 10 }], { id: 2, revision: 2, isCurrent: true, createdAt: at(2026, 10, 21, 9) });
    expect(currentPlanForWeek([old, current], "2026-10-19")?.id).toBe(2);
    expect(currentPlanForWeek([current, old], "2026-10-19")?.id).toBe(2);
  });

  it("falls back to the highest revision, then the newest, when none is flagged current", () => {
    const first = planV2("2026-10-19", [{ name: "A", planned: 7 }], { id: 1, revision: 1, isCurrent: false });
    const second = planV2("2026-10-19", [{ name: "A", planned: 9 }], { id: 2, revision: 2, isCurrent: false });
    expect(currentPlanForWeek([first, second], "2026-10-19")?.id).toBe(2);
    expect(currentPlanForWeek([plan(5, "2026-10-19", at(2026, 10, 19), [1]), plan(6, "2026-10-19", at(2026, 10, 20), [2])], "2026-10-19")?.id).toBe(6);
  });

  it("returns undefined for a week with no plan and never mixes weeks", () => {
    expect(currentPlanForWeek([planV2("2026-10-12", [{ name: "A", planned: 7 }])], "2026-10-19")).toBeUndefined();
    expect(currentPlanForWeek([], "2026-10-19")).toBeUndefined();
  });

  it("names this week and next week by their Mondays", () => {
    expect(weekStartKey(NOW)).toBe("2026-10-19");
    expect(weekStartKey(NOW, 1)).toBe("2026-10-26");
    expect(weekStartKey(at(2026, 10, 25, 23), 1)).toBe("2026-10-26");
    expect(hasPlanNextWeek([planV2("2026-10-26", [{ name: "A", planned: 8 }])], NOW)).toBe(true);
    expect(hasPlanNextWeek([planV2("2026-10-19", [{ name: "A", planned: 8 }])], NOW)).toBe(false);
    expect(hasPlanThisWeek([planV2("2026-10-26", [{ name: "A", planned: 8 }])], NOW)).toBe(false);
  });
});

describe("version-2 planned and logged hours", () => {
  // Example 1 from the design note after the update: A 10 h (4 done), C 4 h; B was removed with 1 h logged.
  const example1 = [planV2("2026-10-19", [{ name: "A", planned: 10, logged: 4 }, { name: "C", planned: 4 }], { removed: [{ name: "B", logged: 1 }] })];
  const sessions = [named("A", at(2026, 10, 20), 240), named("B", at(2026, 10, 20, 15), 60)];

  it("reads the week's total from total_hours", () => {
    expect(plannedHoursThisWeek(example1, NOW)).toBe(14);
  });

  it("keeps a total_hours of 0 (a finished week) rather than falling back", () => {
    expect(plannedHoursThisWeek([planV2("2026-10-19", [{ name: "A", planned: 0 }])], NOW)).toBe(0);
  });

  it("counts only the courses in the current plan", () => {
    expect(loggedHoursThisWeek(sessions, NOW, example1)).toBe(4);
    expect(summariseWeek(example1, sessions, NOW)).toEqual({ weekStart: "2026-10-19", plannedHours: 14, loggedHours: 4 });
    expect(meterText(summariseWeek(example1, sessions, NOW))).toBe("4 of 14 h");
  });

  it("matches course names case-insensitively", () => {
    expect(loggedHoursThisWeek([named("a", at(2026, 10, 20), 120)], NOW, example1)).toBe(2);
  });

  it("does not count logs on a course that was never in the plan", () => {
    expect(loggedHoursThisWeek([...sessions, named("Elective", at(2026, 10, 21), 90)], NOW, example1)).toBe(4);
  });

  it("counts everything when there is no plan for the week", () => {
    expect(loggedHoursThisWeek(sessions, NOW, [])).toBe(5);
    expect(loggedHoursThisWeek(sessions, NOW)).toBe(5);
    expect(loggedHoursThisWeek(sessions, NOW, [planV2("2026-10-12", [{ name: "A", planned: 7 }])])).toBe(5);
    expect(meterText(summariseWeek([], sessions, NOW))).toBe("5 h logged, no plan yet");
  });

  it("counts a course again when its name is added back to the plan", () => {
    const readded = [planV2("2026-10-19", [{ name: "A", planned: 10, logged: 4 }, { name: "B", planned: 2 }])];
    expect(loggedHoursThisWeek(sessions, NOW, readded)).toBe(5);
  });
});

describe("version-2 per-course hours", () => {
  const plans = [
    planV2("2026-10-19", [{ name: "A", planned: 10, logged: 4 }, { name: "C", planned: 4 }, { name: "Quiet", planned: 0 }], {
      removed: [{ name: "B", logged: 1 }],
    }),
  ];
  const sessions = [named("A", at(2026, 10, 20), 240), named("B", at(2026, 10, 20, 15), 60), named("Elective", at(2026, 10, 21), 30)];

  it("is in_plan with the hours left", () => {
    expect(courseHoursThisWeek("A", plans, sessions, NOW)).toEqual({ logged: 4, planned: 10, remaining: 6, status: "in_plan" });
    expect(courseHoursThisWeek("c", plans, sessions, NOW)).toEqual({ logged: 0, planned: 4, remaining: 4, status: "in_plan" });
  });

  it("is done once the planned hours are logged, and stays done past them", () => {
    const exact = [...sessions, named("A", at(2026, 10, 21), 360)];
    expect(courseHoursThisWeek("A", plans, exact, NOW)).toEqual({ logged: 10, planned: 10, remaining: 0, status: "done" });
    const over = [...exact, named("A", at(2026, 10, 22), 30)];
    expect(courseHoursThisWeek("A", plans, over, NOW)).toEqual({ logged: 10.5, planned: 10, remaining: 0, status: "done" });
  });

  it("is done for a course with nothing planned", () => {
    expect(courseHoursThisWeek("Quiet", plans, sessions, NOW)).toMatchObject({ planned: 0, remaining: 0, status: "done" });
  });

  it("is removed for a course taken out of the plan, keeping its logged hours", () => {
    expect(courseHoursThisWeek("B", plans, sessions, NOW)).toEqual({ logged: 1, planned: null, remaining: null, status: "removed" });
  });

  it("is not_in_plan for a course the plan never had, or with no plan at all", () => {
    expect(courseHoursThisWeek("Elective", plans, sessions, NOW)).toEqual({ logged: 0.5, planned: null, remaining: null, status: "not_in_plan" });
    expect(courseHoursThisWeek("A", [], sessions, NOW)).toMatchObject({ planned: null, remaining: null, status: "not_in_plan" });
  });

  it("ignores last week's logs", () => {
    expect(courseHoursThisWeek("A", plans, [named("A", at(2026, 10, 18, 12), 600)], NOW).logged).toBe(0);
  });
});

describe("version-1 plans keep working", () => {
  const legacy = [plan(1, "2026-10-19", at(2026, 10, 19, 8), [3.5, 2])]; // no version, no entered_on, no total_hours

  it("treats allocated hours as planned and the sum as the total", () => {
    expect(plannedHoursThisWeek(legacy, NOW)).toBe(5.5);
    expect(courseHoursThisWeek("C1", legacy, [named("C1", at(2026, 10, 21), 30)], NOW)).toEqual({
      logged: 0.5,
      planned: 2,
      remaining: 1.5,
      status: "in_plan",
    });
  });

  it("counts only the planned courses in the meter too", () => {
    const logs = [named("C0", at(2026, 10, 20), 60), named("Other", at(2026, 10, 20, 15), 60)];
    expect(loggedHoursThisWeek(logs, NOW, legacy)).toBe(1);
  });
});

describe("days left in the week", () => {
  // 19 Oct 2026 is a Monday.
  const days: Array<[string, number, number, string]> = [
    ["Monday", 19, 7, "Mon–Sun"],
    ["Tuesday", 20, 6, "Tue–Sun"],
    ["Wednesday", 21, 5, "Wed–Sun"],
    ["Thursday", 22, 4, "Thu–Sun"],
    ["Friday", 23, 3, "Fri–Sun"],
    ["Saturday", 24, 2, "Sat–Sun"],
    ["Sunday", 25, 1, "Sun"],
  ];

  it.each(days)("%s", (_name, day, count, label) => {
    expect(daysLeft(at(2026, 10, day))).toEqual({ count, label });
    expect(daysLeft(at(2026, 10, day, 0, 5))).toEqual({ count, label });
    expect(daysLeft(at(2026, 10, day, 23, 59))).toEqual({ count, label });
  });
});

// Explicit zones and ISO instants with offsets: these mean the same on any machine.
describe("in an explicit zone", () => {
  const LAGOS = "Africa/Lagos";
  const LA = "America/Los_Angeles";
  const LONDON = "Europe/London";
  const iso = (value: string) => new Date(value);
  const log = (when: string, minutes: number, course = "C0"): SessionHistoryItem => ({ ...session(iso(when), minutes), course_name: course });

  // Lagos is UTC+1: 23:45Z on Sunday 1 Nov is 00:45 on Monday 2 Nov.
  const LAGOS_MONDAY = iso("2026-11-01T23:45:00Z");

  it("names the week by the zone's Monday", () => {
    expect(weekStartKey(LAGOS_MONDAY, 0, LAGOS)).toBe("2026-11-02");
    expect(weekStartKey(LAGOS_MONDAY, 1, LAGOS)).toBe("2026-11-09");
    expect(weekStartKey(LAGOS_MONDAY, -1, LAGOS)).toBe("2026-10-26");
    expect(weekStartKey(LAGOS_MONDAY, 0, "UTC")).toBe("2026-10-26");
    expect(weekStartKey(LAGOS_MONDAY, 0, LA)).toBe("2026-10-26");
  });

  it("gives Monday 00:00 in the zone as an instant, and a date key in the zone", () => {
    expect(startOfLocalWeek(LAGOS_MONDAY, LAGOS).toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(startOfLocalWeek(iso("2026-10-26T02:00:00Z"), LA).toISOString()).toBe("2026-10-19T07:00:00.000Z");
    expect(startOfLocalWeek(iso("2026-10-25T23:30:00Z"), LONDON).toISOString()).toBe("2026-10-18T23:00:00.000Z");
    expect(localDateKey(LAGOS_MONDAY, LAGOS)).toBe("2026-11-02");
    expect(localDateKey(LAGOS_MONDAY, "UTC")).toBe("2026-11-01");
  });

  it("sums the meter with logs straddling Lagos midnight", () => {
    const sessions = [
      log("2026-11-01T22:59:00Z", 60), // Sunday 23:59 Lagos: last week
      log("2026-11-01T23:00:00Z", 30), // Monday 00:00 Lagos: this week
      log("2026-11-01T23:30:00Z", 45), // Monday 00:30 Lagos: this week
      log("2026-11-01T23:50:00Z", 20), // after "now"
    ];
    const plans = [plan(1, "2026-11-02", iso("2026-11-01T23:40:00Z"), [10])];
    expect(summariseWeek(plans, sessions, LAGOS_MONDAY, LAGOS)).toEqual({ weekStart: "2026-11-02", plannedHours: 10, loggedHours: 1.25 });
    // The same clock in UTC is still the week of 26 Oct: no plan there, and the Sunday log counts.
    expect(summariseWeek(plans, sessions, LAGOS_MONDAY, "UTC")).toEqual({ weekStart: "2026-10-26", plannedHours: 0, loggedHours: 2.25 });
  });

  it("counts a log from Monday 00:30 BST in the 169 hour London week, up to Sunday night", () => {
    const sessions = [
      log("2026-10-18T22:30:00Z", 60), // Sunday 23:30 BST: last week
      log("2026-10-18T23:30:00Z", 120), // Monday 00:30 BST: this week
    ];
    expect(loggedHoursThisWeek(sessions, iso("2026-10-25T23:30:00Z"), [], LONDON)).toBe(2); // Sunday 23:30 GMT
  });

  it("counts a 167 hour week up to Sunday night too", () => {
    const sessions = [log("2026-03-22T23:30:00Z", 60), log("2026-03-23T00:30:00Z", 30)]; // Sun 22 Mar 23:30 / Mon 23 Mar 00:30
    expect(loggedHoursThisWeek(sessions, iso("2026-03-29T22:30:00Z"), [], LONDON)).toBe(0.5); // Sunday 23:30 BST
  });

  it("looks up this and next week's plan by the zone's Monday", () => {
    const plans = [plan(1, "2026-11-02", iso("2026-11-01T23:40:00Z"), [4])];
    expect(hasPlanThisWeek(plans, LAGOS_MONDAY, LAGOS)).toBe(true);
    expect(hasPlanThisWeek(plans, LAGOS_MONDAY, LA)).toBe(false);
    expect(hasPlanNextWeek(plans, LAGOS_MONDAY, LA)).toBe(true); // it is still Sunday in Los Angeles
    expect(hasPlanNextWeek(plans, LAGOS_MONDAY, LAGOS)).toBe(false);
    expect(plannedHoursThisWeek(plans, LAGOS_MONDAY, LAGOS)).toBe(4);
  });

  it("splits one course's hours by the zone's week", () => {
    const plans = [plan(1, "2026-11-02", iso("2026-11-01T23:40:00Z"), [3])];
    const sessions = [log("2026-11-01T22:00:00Z", 120), log("2026-11-01T23:30:00Z", 60)];
    expect(courseHoursThisWeek("C0", plans, sessions, LAGOS_MONDAY, LAGOS)).toEqual({ logged: 1, planned: 3, remaining: 2, status: "in_plan" });
  });

  it("marks today in the strip at Sunday 23:30 Lagos, and moves on at midnight", () => {
    const courses = [{ id: 1, name: "C0" }];
    const sundayNight = weekStrip([log("2026-11-01T22:10:00Z", 40)], courses, iso("2026-11-01T22:30:00Z"), LAGOS);
    expect(sundayNight[0].date).toBe("2026-10-26");
    expect(sundayNight.filter((day) => day.isToday).map((day) => day.label)).toEqual(["Sun"]);
    expect(sundayNight[6].minutes).toBe(40);

    const mondayMorning = weekStrip([log("2026-11-01T22:10:00Z", 40)], courses, iso("2026-11-01T23:30:00Z"), LAGOS);
    expect(mondayMorning[0].date).toBe("2026-11-02");
    expect(mondayMorning.filter((day) => day.isToday).map((day) => day.label)).toEqual(["Mon"]);
    expect(mondayMorning.reduce((sum, day) => sum + day.minutes, 0)).toBe(0); // the Sunday log is last week's
  });

  it("counts the days left by the zone's weekday (Sunday evening in Los Angeles)", () => {
    const now = iso("2026-10-26T02:00:00Z"); // Monday in UTC, Sunday 25 Oct 19:00 in Los Angeles
    expect(daysLeft(now, LA)).toEqual({ count: 1, label: "Sun" });
    expect(daysLeft(now, "UTC")).toEqual({ count: 7, label: "Mon–Sun" });
  });
});
