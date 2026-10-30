import { describe, expect, it } from "vitest";

import type { Course, PlanCourseEntry, PlanPreview, SessionHistoryItem, WeeklyPlan, WeeklyPlanDetail } from "@/lib/api";

import {
  adjustmentText,
  buildInput,
  chosenTotal,
  clampedText,
  canPlanAhead,
  dayLabel,
  daysLeftText,
  defaultMoreHours,
  defaultTarget,
  deletedCourses,
  deletedCoursesText,
  difficultyChangedText,
  difficultyChanges,
  draftFromPlan,
  draftSummary,
  findCourseByName,
  hoursText,
  isAdjusted,
  isSaturday,
  isSunday,
  joinNames,
  loggedOnRows,
  newRow,
  newTotalText,
  pastShareText,
  planCourses,
  previewModel,
  rebaseInput,
  rowsFromCourses,
  rowsFromPlan,
  targetWeekStart,
  updatesText,
  validatePlanInput,
  weekCard,
  weekdayIndex,
  type PlannerRow,
} from "./plan-model";

// Wednesday 28 Oct 2026, local time; the week started Monday 26 Oct.
const WEDNESDAY = new Date(2026, 9, 28, 10, 0);
const SATURDAY = new Date(2026, 9, 31, 10, 0);
const SUNDAY = new Date(2026, 10, 1, 20, 0);
const MONDAY = new Date(2026, 9, 26, 9, 0);

const course = (id: number, name: string, difficulty: number): Course => ({
  id,
  name,
  difficulty,
  learning_demands: [],
  builds_on_earlier: null,
  assessment_format: "",
  exam_date: null,
  weekly_target_hours: 3,
  created_at: "",
  updated_at: "",
});

function entry(name: string, planned: number, overrides: Partial<PlanCourseEntry> = {}): PlanCourseEntry {
  return {
    course_id: null,
    name,
    difficulty: 3,
    factor: 1,
    adjustment_source: "none",
    adherence_estimate: null,
    entered_on: "2026-10-26",
    logged_at_revision: 0,
    remaining_at_revision: planned,
    planned_hours: planned,
    focus_block_minutes: 50,
    break_minutes: 10,
    ...overrides,
  };
}

function plan(
  revision: number,
  courses: PlanCourseEntry[],
  json: Partial<WeeklyPlan["plan_json"]> = {},
  overrides: Partial<WeeklyPlan> = {},
): WeeklyPlan {
  const total = courses.reduce((sum, item) => sum + item.planned_hours, 0);
  return {
    id: revision,
    week_start: "2026-10-26",
    revision,
    revision_count: revision,
    is_current: true,
    superseded_at: null,
    created_at: "2026-10-26T09:00:00Z",
    updated_at: "2026-10-26T09:00:00Z",
    plan_json: {
      version: 2,
      mode: revision === 1 ? "first" : "update",
      made_on: "2026-10-26",
      total_hours: total,
      more_hours: total,
      counted_hours: 0,
      clamped: false,
      courses,
      removed: [],
      total_available_hours: total,
      allocations: [],
      ...json,
    },
    ...overrides,
  };
}

let sessionId = 0;
function session(name: string, hours: number, at = "2026-10-27T10:00:00"): SessionHistoryItem {
  return {
    id: ++sessionId,
    course_name: name,
    planned_minutes: 50,
    actual_minutes: hours * 60,
    focus_score: 4,
    completion_rate: 1,
    adherence_score: 1,
    predicted_adherence: null,
    model_version: "",
    // Local time (no Z), so the test doesn't depend on the machine's time zone.
    created_at: new Date(at).toISOString(),
  };
}

const row = (name: string, difficulty = 3, courseId: number | null = null): PlannerRow => ({
  key: `row-${name}`,
  courseId,
  name,
  difficulty,
});

// The note's starting point: A 7 h / B 3 h; logged A 4 h, B 1 h.
const START = plan(1, [entry("A", 7, { difficulty: 4 }), entry("B", 3, { difficulty: 2 })]);
const LOGS = [session("A", 3), session("A", 1, "2026-10-28T08:00:00"), session("b", 1)];

describe("weeks", () => {
  it("offers next week first on Sunday only", () => {
    expect(defaultTarget(SUNDAY)).toBe("next");
    expect(defaultTarget(SATURDAY)).toBe("this");
    expect(defaultTarget(WEDNESDAY)).toBe("this");
  });

  it("allows planning ahead on Saturday and Sunday", () => {
    expect(canPlanAhead(SATURDAY)).toBe(true);
    expect(canPlanAhead(SUNDAY)).toBe(true);
    expect(canPlanAhead(MONDAY)).toBe(false);
    expect(canPlanAhead(WEDNESDAY)).toBe(false);
  });

  it("names the Monday of the week being planned", () => {
    expect(targetWeekStart(SUNDAY, "this")).toBe("2026-10-26");
    expect(targetWeekStart(SUNDAY, "next")).toBe("2026-11-02");
  });

  it("words dates and days left", () => {
    expect(dayLabel("2026-11-02")).toBe("Mon 2 Nov");
    expect(dayLabel("2026-10-28T09:00:00Z")).toBe("Wed 28 Oct");
    expect(daysLeftText({ count: 5, label: "Wed–Sun" })).toBe("5 days left this week, Wed–Sun");
    expect(daysLeftText({ count: 1, label: "Sun" })).toBe("1 day left this week, Sun");
  });
});

describe("how many more hours", () => {
  it("example 1, B dropped in the form: the total less what the plan's courses have done", () => {
    const rows = [row("A", 5), row("C", 2)];
    const counted = loggedOnRows(rows, LOGS, WEDNESDAY);
    expect(counted).toBe(4);
    expect(defaultMoreHours(chosenTotal(START), counted)).toBe(6);
  });

  it("example 1, B deleted on /courses: the total the user chose, not the shrunk one", () => {
    const afterDelete: WeeklyPlanDetail = {
      ...plan(2, [entry("A", 7, { logged_at_revision: 4, remaining_at_revision: 3 })], {
        mode: "course_deleted",
        made_on: "2026-10-28",
        removed: [{ course_id: 2, name: "B", removed_on: "2026-10-28", logged_hours: 1 }],
      }),
      days_left: 5,
      revisions: [{ ...START, is_current: false }],
    };
    expect(chosenTotal(afterDelete)).toBe(10);
    expect(defaultMoreHours(chosenTotal(afterDelete), loggedOnRows([row("A", 5)], LOGS, WEDNESDAY))).toBe(6);
  });

  it("example 2: both courses replaced, nothing counted, the whole total again", () => {
    expect(defaultMoreHours(10, loggedOnRows([row("D", 4), row("E", 2)], LOGS, WEDNESDAY))).toBe(10);
  });

  it("never goes below 0", () => {
    expect(defaultMoreHours(4, 5)).toBe(0);
  });

  it("counts each course once, ignoring case, and only this week", () => {
    const logs = [...LOGS, session("A", 2, "2026-10-20T10:00:00")];
    expect(loggedOnRows([row("a"), row("A "), row("")], logs, WEDNESDAY)).toBe(4);
  });
});

describe("course rows", () => {
  it("makes one row per saved course with its id, stored name and difficulty", () => {
    const rows = rowsFromCourses([course(4, "CSC 401 Algorithms", 4), course(9, "MTH 401", 2)]);
    expect(rows).toEqual([
      { key: "course-4", courseId: 4, name: "CSC 401 Algorithms", difficulty: 4 },
      { key: "course-9", courseId: 9, name: "MTH 401", difficulty: 2 },
    ]);
  });

  it("takes a plan's courses with the saved course's id and its current difficulty", () => {
    const rows = rowsFromPlan(START, [course(1, "A", 5), course(2, "B", 1)]);
    expect(rows).toEqual([
      { key: "course-1", courseId: 1, name: "A", difficulty: 5 },
      { key: "course-2", courseId: 2, name: "B", difficulty: 1 },
    ]);
  });

  it("keeps the plan's difficulty for a course that is no longer saved", () => {
    const rows = rowsFromPlan(START, [course(1, "A", 5)]);
    expect(rows).toEqual([
      { key: "course-1", courseId: 1, name: "A", difficulty: 5 },
      { key: "plan-1", courseId: null, name: "B", difficulty: 2 },
    ]);
  });

  it("starts a new row at difficulty 3 with no name or saved course", () => {
    expect(newRow("x")).toEqual({ key: "x", courseId: null, name: "", difficulty: 3 });
  });

  it("finds a saved course ignoring case and spacing", () => {
    expect(findCourseByName([course(1, "CSC 401", 3)], "  csc 401 ")?.id).toBe(1);
  });
});

describe("last week's plan as a draft", () => {
  const lastWeek = plan(1, [entry("A", 6), entry("B", 4), entry("Gone", 2)], { total_hours: 12 }, { week_start: "2026-10-19" });

  it("keeps the total and the courses that still exist", () => {
    const draft = draftFromPlan(lastWeek, [course(1, "A", 3), course(2, "B", 3)]);
    expect(draft?.totalHours).toBe(12);
    expect(draft?.rows.map((item) => item.name)).toEqual(["A", "B"]);
    expect(draftSummary(draft!)).toBe("12 h, 2 courses");
  });

  it("is null when none of its courses exist any more", () => {
    expect(draftFromPlan(lastWeek, [course(7, "Other", 3)])).toBeNull();
  });

  it("fills each row with the course's current difficulty, not the one last week used", () => {
    const draft = draftFromPlan(lastWeek, [course(1, "A", 5), course(2, "B", 1)]);
    expect(draft?.rows.map((item) => item.difficulty)).toEqual([5, 1]);
  });
});

describe("a difficulty changed on /courses", () => {
  const used = plan(1, [entry("Calculus", 6, { course_id: 1, difficulty: 3 }), entry("Statistics", 4, { course_id: 2, difficulty: 2 })]);

  it("is empty while the saved difficulties match the plan", () => {
    expect(difficultyChanges(used, [course(1, "Calculus", 3), course(2, "Statistics", 2)])).toEqual([]);
  });

  it("lists the courses whose saved difficulty differs", () => {
    expect(difficultyChanges(used, [course(1, "Calculus", 5), course(2, "Statistics", 2)])).toEqual([
      { name: "Calculus", now: 5, used: 3 },
    ]);
  });

  it("matches by course id first, so a rename still counts", () => {
    expect(difficultyChanges(used, [course(1, "Calculus 3", 4), course(2, "Statistics", 2)])).toEqual([
      { name: "Calculus 3", now: 4, used: 3 },
    ]);
  });

  it("falls back to the name when the entry has no course id", () => {
    const named = plan(1, [entry("calculus ", 6, { difficulty: 3 })]);
    expect(difficultyChanges(named, [course(9, "Calculus", 1)])).toEqual([{ name: "Calculus", now: 1, used: 3 }]);
  });

  it("skips entries without a numeric difficulty, courses that no longer exist and removed courses", () => {
    const old = plan(1, [entry("Calculus", 6, { difficulty: undefined as unknown as number }), entry("Gone", 2, { difficulty: 2 })], {
      removed: [{ course_id: 3, name: "Dropped", removed_on: "2026-10-27", logged_hours: 0 }],
    });
    expect(difficultyChanges(old, [course(1, "Calculus", 5), course(3, "Dropped", 5)])).toEqual([]);
  });

  it("is gone once the update carries the new difficulty", () => {
    const updated = plan(2, [entry("Calculus", 6, { course_id: 1, difficulty: 5 }), entry("Statistics", 4, { course_id: 2, difficulty: 2 })]);
    const saved = [course(1, "Calculus", 5), course(2, "Statistics", 2)];
    expect(difficultyChanges(used, saved)).toHaveLength(1);
    expect(difficultyChanges(updated, saved)).toEqual([]);
  });

  it("words one course and several", () => {
    expect(difficultyChangedText([{ name: "Calculus", now: 5, used: 3 }])).toBe(
      "Calculus is now difficulty 5; this week's plan used 3. Update the plan to re-split your remaining hours.",
    );
    expect(
      difficultyChangedText([
        { name: "Calculus", now: 5, used: 3 },
        { name: "Statistics", now: 1, used: 2 },
      ]),
    ).toBe("Difficulty changed for Calculus and Statistics since this week's plan was made. Update the plan to re-split your remaining hours.");
  });
});

describe("the request", () => {
  const rows: PlannerRow[] = [
    { key: "a", courseId: 1, name: "CSC 401", difficulty: 4 },
    { key: "b", courseId: null, name: "  New course  ", difficulty: 2.6 },
    { key: "c", courseId: null, name: "   ", difficulty: 5 },
  ];

  it("trims names, drops blank rows and keeps difficulty a whole number from 1 to 5", () => {
    expect(planCourses(rows)).toEqual([
      { name: "CSC 401", difficulty: 4 },
      { name: "New course", difficulty: 3 },
    ]);
  });

  it("sends a total for a first plan and more hours for an update", () => {
    expect(buildInput(rows, 12, null)).toEqual({ courses: planCourses(rows), total_hours: 12, base_revision: null });
    expect(buildInput(rows, 10, 3)).toEqual({ courses: planCourses(rows), more_hours: 10, base_revision: 3 });
  });

  it("after a conflict, turns a total into more hours against the plan that now exists", () => {
    const first = buildInput(rows, 12, null);
    expect(rebaseInput(first, 1, 4)).toEqual({ courses: first.courses, more_hours: 8, base_revision: 1 });
    const update = buildInput(rows, 6, 2);
    expect(rebaseInput(update, 3, 4)).toEqual({ courses: update.courses, more_hours: 6, base_revision: 3 });
    expect(rebaseInput(update, null, 4)).toEqual({ courses: update.courses, total_hours: 10, base_revision: null });
  });
});

describe("validatePlanInput", () => {
  const rows = [row("A")];

  it("takes a first plan's total from 1 to 168", () => {
    expect(validatePlanInput(rows, 12)).toEqual({});
    expect(validatePlanInput(rows, 0).hours).toBe("Enter a number of hours from 1 to 168.");
    expect(validatePlanInput(rows, Number.NaN).hours).toBeDefined();
  });

  it("takes an update's more hours from 0 up to what the week can still hold", () => {
    expect(validatePlanInput(rows, 0, "more", 5)).toEqual({});
    expect(validatePlanInput(rows, -1, "more", 5).hours).toBe("Enter a number of hours from 0 to 163.");
    expect(validatePlanInput(rows, 164, "more", 5).hours).toBeDefined();
  });

  it("needs at least one named course, at most 20, and no duplicates", () => {
    expect(validatePlanInput([row(" ")], 12).courses).toBe("Add at least one course to plan.");
    expect(validatePlanInput([row("A"), row(" a ")], 12).courses).toBe('"a" is listed twice. Keep one row for each course.');
    const many = Array.from({ length: 21 }, (_, index) => row(`C${index}`));
    expect(validatePlanInput(many, 12).courses).toBe("A plan can include up to 20 courses.");
  });
});

describe("weekCard", () => {
  // Example 1 saved: A 10 h (4 done), C 4 h; B removed with 1 h logged.
  const example1 = plan(
    2,
    [
      entry("A", 10, { difficulty: 5, logged_at_revision: 4, remaining_at_revision: 6 }),
      entry("C", 4, { difficulty: 2, entered_on: "2026-10-28" }),
    ],
    {
      made_on: "2026-10-28",
      more_hours: 10,
      counted_hours: 4,
      removed: [{ course_id: 2, name: "B", removed_on: "2026-10-28", logged_hours: 1 }],
    },
  );

  it("shows planned, logged and left per course, with the removed course not counted", () => {
    const card = weekCard(example1, LOGS, WEDNESDAY);
    expect(card.total).toBe(14);
    expect(card.logged).toBe(4);
    expect(card.rows).toEqual([
      { name: "A", logged: 4, planned: 10, remaining: 6, status: "in_plan" },
      { name: "C", logged: 0, planned: 4, remaining: 4, status: "in_plan" },
    ]);
    expect(card.removed).toEqual([{ name: "B", logged: 1 }]);
    expect(card.complete).toBe(false);
    expect(updatesText(card)).toBe("Updated once · last Wed 28 Oct");
  });

  it("example 3a: a course past its share is done for the week", () => {
    const example3a = plan(2, [
      entry("A", 4, { logged_at_revision: 4, remaining_at_revision: 0 }),
      entry("B", 2, { logged_at_revision: 1, remaining_at_revision: 1 }),
    ]);
    const card = weekCard(example3a, LOGS, WEDNESDAY);
    expect(card.rows.map((item) => [item.name, item.status, item.remaining])).toEqual([
      ["A", "done", 0],
      ["B", "in_plan", 1],
    ]);
    expect(card.logged).toBe(5);
  });

  it("is complete when every course has its hours, and says when nothing was planned", () => {
    const done = plan(3, [entry("A", 4), entry("C", 0)], {}, { revision_count: 3 });
    const card = weekCard(done, LOGS, WEDNESDAY);
    expect(card.rows.map((item) => item.status)).toEqual(["done", "none_planned"]);
    expect(card.complete).toBe(true);
    expect(updatesText(card)).toBe("Updated 2 times · last Mon 26 Oct");
  });

  it("says nothing about updates for a first plan", () => {
    expect(updatesText(weekCard(START, LOGS, WEDNESDAY))).toBeNull();
  });
});

describe("a course deleted mid-week", () => {
  const deletion = (revisions: WeeklyPlan[]): WeeklyPlanDetail => ({
    ...plan(2, [entry("A", 7)], {
      mode: "course_deleted",
      made_on: "2026-10-28",
      removed: [{ course_id: 2, name: "B", removed_on: "2026-10-28", logged_hours: 1 }],
    }),
    days_left: 5,
    revisions,
  });

  it("names the course and the hours it still had", () => {
    const deleted = deletedCourses(deletion([{ ...START, is_current: false }]));
    expect(deleted).toEqual({ names: ["B"], hoursLeft: 2 });
    expect(deletedCoursesText(deleted!)).toBe(
      "You removed B from your courses, so its 2 h left this week were dropped. Update the plan to share them out.",
    );
  });

  it("covers several deletions in a row", () => {
    const first = plan(1, [entry("A", 5), entry("B", 3), entry("D", 2)]);
    const second = plan(2, [entry("A", 5), entry("B", 3)], {
      mode: "course_deleted",
      removed: [{ course_id: 4, name: "D", removed_on: "2026-10-27", logged_hours: 0 }],
    });
    const current: WeeklyPlanDetail = {
      ...plan(3, [entry("A", 5)], {
        mode: "course_deleted",
        removed: [
          { course_id: 4, name: "D", removed_on: "2026-10-27", logged_hours: 0 },
          { course_id: 2, name: "B", removed_on: "2026-10-28", logged_hours: 1 },
        ],
      }),
      days_left: 5,
      revisions: [first, second],
    };
    const deleted = deletedCourses(current)!;
    expect(deleted).toEqual({ names: ["D", "B"], hoursLeft: 4 });
    expect(deletedCoursesText(deleted)).toContain("You removed D and B from your courses, so their 4 h left this week were dropped.");
  });

  it("is quiet once the user has updated the plan", () => {
    expect(deletedCourses({ ...START, days_left: 5 })).toBeNull();
  });

  it("words a course that had nothing left", () => {
    expect(deletedCoursesText({ names: ["B"], hoursLeft: 0 })).toBe("You removed B from your courses. It had no hours left this week.");
  });
});

describe("previewModel", () => {
  const preview = (courses: PlanCourseEntry[], json: Partial<PlanPreview["plan_json"]> = {}, clamped = false): PlanPreview => ({
    week_start: "2026-10-26",
    base_revision: 1,
    days_left: 5,
    clamped,
    plan_json: plan(2, courses, { clamped, ...json }).plan_json,
  });

  it("example 1: Course · Done · New plan · Left, the new course marked and B removed", () => {
    const model = previewModel(
      preview(
        [
          entry("A", 10, { difficulty: 5, logged_at_revision: 4, remaining_at_revision: 6 }),
          entry("C", 4, { difficulty: 2 }),
        ],
        {
          total_hours: 14,
          more_hours: 10,
          counted_hours: 4,
          removed: [{ course_id: 2, name: "B", removed_on: "2026-10-28", logged_hours: 1 }],
        },
      ),
      START,
    );
    expect(model.rows.map(({ name, done, planned, left, isNew }) => ({ name, done, planned, left, isNew }))).toEqual([
      { name: "A", done: 4, planned: 10, left: 6, isNew: false },
      { name: "C", done: 0, planned: 4, left: 4, isNew: true },
    ]);
    expect(model.removed).toEqual([{ name: "B", logged: 1 }]);
    expect(newTotalText(model)).toBe("New total 14 h (4 done + 10 more)");
    expect(model.pastShare).toEqual([]);
  });

  it("example 3a: names the course already past its share", () => {
    const model = previewModel(
      preview(
        [
          entry("A", 4, { logged_at_revision: 4, remaining_at_revision: 0 }),
          entry("B", 2, { logged_at_revision: 1, remaining_at_revision: 1 }),
        ],
        { total_hours: 6, more_hours: 1, counted_hours: 5 },
      ),
      START,
    );
    expect(model.pastShare).toEqual(["A"]);
    expect(pastShareText(model.pastShare)).toBe("A is already past its share; it gets no more hours this week.");
    expect(newTotalText(model)).toBe("New total 6 h (5 done + 1 more)");
  });

  it("example 3b: a total below what is done is clamped, and nobody is 'past their share'", () => {
    const model = previewModel(
      preview(
        [
          entry("A", 4, { logged_at_revision: 4, remaining_at_revision: 0 }),
          entry("B", 1, { logged_at_revision: 1, remaining_at_revision: 0 }),
        ],
        { total_hours: 5, more_hours: 0, counted_hours: 5 },
        true,
      ),
      null,
    );
    expect(model.clamped).toBe(true);
    expect(clampedText(model.counted)).toBe("You've already done 5 h, so the total stays at 5 h.");
    expect(model.pastShare).toEqual([]);
    expect(model.rows.every((item) => !item.isNew)).toBe(true);
  });

  it("leaves out courses removed earlier with nothing logged", () => {
    const model = previewModel(
      preview([entry("A", 10)], { removed: [{ course_id: 9, name: "Old", removed_on: "2026-10-26", logged_hours: 0 }] }),
      plan(2, [entry("A", 7)]),
    );
    expect(model.removed).toEqual([]);
  });
});

describe("wording", () => {
  it("says where an adjustment came from", () => {
    expect(adjustmentText({ adjustment_source: "model" })).toBe("Adjusted from your forecast");
    expect(adjustmentText({ adjustment_source: "rule" })).toBe("Adjusted from your recent adherence");
    expect(adjustmentText({ adjustment_source: "none" })).toBe("No adjustment yet");
  });

  it("counts a course as adjusted only with a source and a factor other than 1", () => {
    expect(isAdjusted({ adjustment_source: "model", factor: 0.9 })).toBe(true);
    expect(isAdjusted({ adjustment_source: "model", factor: 1 })).toBe(false);
    expect(isAdjusted({ adjustment_source: "none", factor: 0.9 })).toBe(false);
  });

  it("joins names and hours plainly", () => {
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    expect(hoursText(6)).toBe("6 h");
    expect(hoursText(6.94)).toBe("6.9 h");
  });
});

describe("weeks in an explicit zone", () => {
  const LA = "America/Los_Angeles";
  const LAGOS = "Africa/Lagos";
  // Saturday 31 Oct 18:00 in Los Angeles (PDT) is already Sunday 1 Nov 01:00 in UTC.
  const LA_SATURDAY = new Date("2026-11-01T01:00:00Z");
  // Sunday 1 Nov 23:30 UTC is Monday 2 Nov 00:30 in Lagos.
  const LAGOS_MONDAY = new Date("2026-11-01T23:30:00Z");

  it("is still Saturday in Los Angeles: this week, with next week open to plan", () => {
    expect(isSaturday(LA_SATURDAY, LA)).toBe(true);
    expect(isSunday(LA_SATURDAY, LA)).toBe(false);
    expect(canPlanAhead(LA_SATURDAY, LA)).toBe(true);
    expect(defaultTarget(LA_SATURDAY, LA)).toBe("this");
    expect(targetWeekStart(LA_SATURDAY, "this", LA)).toBe("2026-10-26");
    expect(targetWeekStart(LA_SATURDAY, "next", LA)).toBe("2026-11-02");
  });

  it("is Sunday for the same instant in UTC", () => {
    expect(weekdayIndex(LA_SATURDAY, "UTC")).toBe(6);
    expect(defaultTarget(LA_SATURDAY, "UTC")).toBe("next");
  });

  it("has moved on to Monday in Lagos", () => {
    expect(weekdayIndex(LAGOS_MONDAY, LAGOS)).toBe(0);
    expect(canPlanAhead(LAGOS_MONDAY, LAGOS)).toBe(false);
    expect(defaultTarget(LAGOS_MONDAY, LAGOS)).toBe("this");
    expect(targetWeekStart(LAGOS_MONDAY, "this", LAGOS)).toBe("2026-11-02");
  });

  it("counts logged hours in the zone's week", () => {
    const logs = [session("A", 1, "2026-10-31T12:00:00Z"), session("A", 2, "2026-11-01T23:10:00Z")]; // Sat noon UTC, Monday 00:10 Lagos
    expect(loggedOnRows([row("A", 5)], logs, LAGOS_MONDAY, LAGOS)).toBe(2);
    expect(loggedOnRows([row("A", 5)], logs, LAGOS_MONDAY, "UTC")).toBe(3);
  });
});
