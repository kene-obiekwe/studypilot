import { describe, expect, it } from "vitest";

import type { PlanHistoryItem, SessionHistoryItem } from "./api";
import {
  clampPlanned,
  defaultPlannedMinutes,
  describeElapsed,
  elapsedMs,
  formatElapsed,
  parseTimer,
  prefillActualMinutes,
  serializeTimer,
  timerForUser,
  type TimerState,
} from "./timer";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
// Wednesday 22 Oct 2025; the local week starts Monday 20 Oct.
const NOW = at(2025, 10, 22, 15);
const TIMER: TimerState = { userId: 4, courseId: 7, courseName: "Calculus", startedAt: NOW.getTime() - 65_000, plannedMinutes: 50 };

function plan(weekStart: string, allocations: NonNullable<PlanHistoryItem["plan_json"]["allocations"]>): PlanHistoryItem {
  return { id: 1, week_start: weekStart, created_at: at(2025, 10, 20, 9).toISOString(), plan_json: { allocations } };
}

function session(courseName: string, when: Date, actual: number): SessionHistoryItem {
  return {
    id: when.getTime(),
    course_name: courseName,
    planned_minutes: 60,
    actual_minutes: actual,
    focus_score: 0.6,
    completion_rate: 0.7,
    adherence_score: 0.8,
    predicted_adherence: null,
    model_version: "v",
    created_at: when.toISOString(),
  };
}

describe("timer state", () => {
  it("round-trips through storage and rejects bad values", () => {
    expect(parseTimer(serializeTimer(TIMER))).toEqual(TIMER);
    expect(parseTimer(null)).toBeNull();
    expect(parseTimer("not json")).toBeNull();
    expect(parseTimer(JSON.stringify({ ...TIMER, startedAt: "yesterday" }))).toBeNull();
    expect(parseTimer(JSON.stringify({ ...TIMER, courseName: "  " }))).toBeNull();
    expect(parseTimer(JSON.stringify({ ...TIMER, plannedMinutes: 9999 }))?.plannedMinutes).toBe(240);
  });

  it("belongs to the user who started it", () => {
    expect(timerForUser(TIMER, 4)).toEqual(TIMER);
    expect(timerForUser(TIMER, 5)).toBeNull();
    expect(timerForUser(TIMER, null)).toEqual(TIMER); // user unknown: still shown
    expect(timerForUser(null, 4)).toBeNull();
  });
});

describe("elapsed time", () => {
  it("is computed from startedAt, never negative", () => {
    expect(elapsedMs(TIMER, NOW.getTime())).toBe(65_000);
    expect(elapsedMs(TIMER, TIMER.startedAt - 5_000)).toBe(0);
  });

  it("formats as mm:ss, then h:mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_999)).toBe("01:05");
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe("59:59");
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3 * 3_600_000 + 2 * 60_000 + 9_000)).toBe("3:02:09");
  });

  it("has a spoken form", () => {
    expect(describeElapsed(30_000)).toBe("0 minutes");
    expect(describeElapsed(60_000)).toBe("1 minute");
    expect(describeElapsed(62 * 60_000)).toBe("1 hour 2 minutes");
    expect(describeElapsed(120 * 60_000)).toBe("2 hours");
  });

  it("pre-fills actual minutes: at least 1, capped at 12 hours", () => {
    expect(prefillActualMinutes(10_000)).toEqual({ minutes: 1, capped: false });
    expect(prefillActualMinutes(44.6 * 60_000)).toEqual({ minutes: 45, capped: false });
    expect(prefillActualMinutes(14 * 3_600_000)).toEqual({ minutes: 720, capped: true });
  });

  it("clamps planned minutes to 5..240", () => {
    expect(clampPlanned(2)).toBe(5);
    expect(clampPlanned(500)).toBe(240);
    expect(clampPlanned(Number.NaN)).toBe(50);
  });
});

describe("default planned minutes", () => {
  const base = { courseName: "Calculus", plans: [] as PlanHistoryItem[], sessions: [] as SessionHistoryItem[], now: NOW };

  it("is 50 minutes with no plan and no weekly target", () => {
    expect(defaultPlannedMinutes(base)).toBe(50);
  });

  it("uses the plan's focus block for the course", () => {
    const plans = [plan("2025-10-20", [{ course: "calculus", allocated_hours: 4, focus_block_minutes: 40 }])];
    expect(defaultPlannedMinutes({ ...base, plans })).toBe(40);
  });

  it("ignores last week's plan", () => {
    const plans = [plan("2025-10-13", [{ course: "Calculus", allocated_hours: 4, focus_block_minutes: 40 }])];
    expect(defaultPlannedMinutes({ ...base, plans })).toBe(50);
  });

  it("shortens to what is left of this week's allocation, not under 15", () => {
    const plans = [plan("2025-10-20", [{ course: "Calculus", allocated_hours: 2, focus_block_minutes: 50 }])];
    const logged = (minutes: number) => [session("Calculus", at(2025, 10, 21), minutes), session("Other", at(2025, 10, 21), 500)];
    expect(defaultPlannedMinutes({ ...base, plans, sessions: logged(90) })).toBe(30);
    expect(defaultPlannedMinutes({ ...base, plans, sessions: logged(113) })).toBe(15);
    // Allocation used up: back to a full block.
    expect(defaultPlannedMinutes({ ...base, plans, sessions: logged(150) })).toBe(50);
  });

  it("falls back to the course's weekly target when the plan leaves it out", () => {
    const sessions = [session("Calculus", at(2025, 10, 20), 40)];
    expect(defaultPlannedMinutes({ ...base, weeklyTargetHours: 1, sessions })).toBe(20);
    // Last week's logs don't count.
    expect(defaultPlannedMinutes({ ...base, weeklyTargetHours: 1, sessions: [session("Calculus", at(2025, 10, 17), 40)] })).toBe(50);
  });
});

describe("defaultPlannedMinutes from a version-2 plan", () => {
  // Wednesday 22 Oct 2025. Example 1 from the design note: A planned 10 h, 4 h done when the plan was made.
  const v2: PlanHistoryItem = {
    id: 2,
    week_start: "2025-10-20",
    created_at: at(2025, 10, 21, 9).toISOString(),
    plan_json: {
      version: 2,
      total_hours: 14,
      courses: [
        {
          course_id: 1,
          name: "A",
          planned_hours: 10,
          logged_at_revision: 4,
          remaining_at_revision: 6,
          entered_on: "2025-10-20",
          focus_block_minutes: 50,
        },
        { course_id: 2, name: "C", planned_hours: 4, logged_at_revision: 0, remaining_at_revision: 4, entered_on: "2025-10-21", focus_block_minutes: 40 },
      ],
      removed: [{ course_id: 3, name: "B", removed_on: "2025-10-21", logged_hours: 1 }],
    },
  };
  const base = { courseName: "A", plans: [v2], now: NOW };
  const logged = (minutes: number) => [session("A", at(2025, 10, 21), minutes)];

  it("suggests the block while 6 hours are left", () => {
    expect(defaultPlannedMinutes({ ...base, sessions: logged(240) })).toBe(50);
  });

  it("suggests the remainder when 20 minutes are left", () => {
    expect(defaultPlannedMinutes({ ...base, sessions: logged(580) })).toBe(20);
  });

  it("suggests the block again once the course is done, exactly or past it", () => {
    expect(defaultPlannedMinutes({ ...base, sessions: logged(600) })).toBe(50);
    expect(defaultPlannedMinutes({ ...base, sessions: logged(700) })).toBe(50);
  });

  it("follows the logs live: each session shortens the remainder", () => {
    const more = (minutes: number) => [...logged(500), session("a", at(2025, 10, 22, 9), minutes)];
    expect(defaultPlannedMinutes({ ...base, sessions: more(40) })).toBe(50); // 60 min left: still a full block
    expect(defaultPlannedMinutes({ ...base, sessions: more(75) })).toBe(25); // 25 min left
  });

  it("uses the course's own focus block from the plan", () => {
    expect(defaultPlannedMinutes({ ...base, courseName: "C", sessions: [] })).toBe(40);
  });

  it("falls back to the weekly target for a course not in the plan (removed or never planned)", () => {
    const sessions = [session("B", at(2025, 10, 21), 40)];
    expect(defaultPlannedMinutes({ ...base, courseName: "B", weeklyTargetHours: 1, sessions })).toBe(20);
    expect(defaultPlannedMinutes({ ...base, courseName: "B", sessions })).toBe(50);
  });

  it("ignores last week's logs and a superseded revision", () => {
    const superseded = { ...v2, id: 1, revision: 1, is_current: false, plan_json: { ...v2.plan_json, courses: [{ ...v2.plan_json.courses![0], planned_hours: 1 }] } };
    const current = { ...v2, revision: 2, is_current: true };
    expect(defaultPlannedMinutes({ ...base, plans: [superseded, current], sessions: [session("A", at(2025, 10, 17), 9999)] })).toBe(50);
  });
});

describe("default planned minutes in an explicit zone", () => {
  const LAGOS = "Africa/Lagos";
  // Monday 2 Nov 00:45 in Lagos (UTC+1), still Sunday in UTC.
  const NOW_LAGOS = new Date("2026-11-01T23:45:00Z");
  const sessions = [session("Calculus", new Date("2026-11-01T23:10:00Z"), 90)]; // Monday 00:10 Lagos
  const base = { courseName: "Calculus", sessions, now: NOW_LAGOS };

  it("counts logs by the zone's week", () => {
    const plans = [plan("2026-11-02", [{ course: "Calculus", allocated_hours: 2, focus_block_minutes: 50 }])];
    expect(defaultPlannedMinutes({ ...base, plans, zone: LAGOS })).toBe(30); // 2 h planned, 90 min logged
  });

  it("does not use the plan of a week the zone has not reached", () => {
    const plans = [plan("2026-11-02", [{ course: "Calculus", allocated_hours: 2, focus_block_minutes: 40 }])];
    expect(defaultPlannedMinutes({ ...base, plans, zone: "UTC" })).toBe(50); // still the week of 26 Oct there
  });

  it("leaves out last week's log at Sunday 23:59 Lagos", () => {
    const plans = [plan("2026-11-02", [{ course: "Calculus", allocated_hours: 2, focus_block_minutes: 50 }])];
    const late = [session("Calculus", new Date("2026-11-01T22:59:00Z"), 90)];
    expect(defaultPlannedMinutes({ ...base, plans, sessions: late, zone: LAGOS })).toBe(50);
  });
});
