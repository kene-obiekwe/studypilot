import { describe, expect, it } from "vitest";

import type { Course } from "@/lib/api";

import {
  adjustmentText,
  buildPayload,
  estimateText,
  findCourseByName,
  hoursChanged,
  hoursText,
  isAdjusted,
  newRow,
  rowsFromCourses,
  validatePlanInput,
  type PlannerRow,
} from "./plan-model";

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

describe("rowsFromCourses", () => {
  it("makes one row per saved course with its id, stored name and difficulty", () => {
    const rows = rowsFromCourses([course(4, "CSC 401 Algorithms", 4), course(9, "MTH 401", 2)]);
    expect(rows).toEqual([
      { key: "course-4", courseId: 4, name: "CSC 401 Algorithms", difficulty: 4 },
      { key: "course-9", courseId: 9, name: "MTH 401", difficulty: 2 },
    ]);
  });

  it("gives every row its own key", () => {
    const rows = rowsFromCourses([course(1, "A", 3), course(2, "B", 3)]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it("returns nothing for no courses", () => {
    expect(rowsFromCourses([])).toEqual([]);
  });
});

describe("buildPayload", () => {
  const rows: PlannerRow[] = [
    { key: "a", courseId: 1, name: "CSC 401", difficulty: 4 },
    { key: "b", courseId: null, name: "  New course  ", difficulty: 2 },
    { key: "c", courseId: null, name: "   ", difficulty: 5 },
  ];

  it("turns saved and new rows into the request, trimming names and dropping blank ones", () => {
    expect(buildPayload(rows, 12)).toEqual({
      total_available_hours: 12,
      courses: [
        { name: "CSC 401", difficulty: 4 },
        { name: "New course", difficulty: 2 },
      ],
    });
  });

  it("uses this plan's difficulty, not the saved one", () => {
    const [saved] = rowsFromCourses([course(1, "CSC 401", 4)]);
    expect(buildPayload([{ ...saved, difficulty: 5 }], 10).courses).toEqual([{ name: "CSC 401", difficulty: 5 }]);
  });

  it("keeps difficulty a whole number from 1 to 5", () => {
    const odd = (difficulty: number): PlannerRow => ({ key: "x", courseId: null, name: "X", difficulty });
    expect(buildPayload([odd(0)], 5).courses[0].difficulty).toBe(1);
    expect(buildPayload([odd(9)], 5).courses[0].difficulty).toBe(5);
    expect(buildPayload([odd(3.6)], 5).courses[0].difficulty).toBe(4);
    expect(buildPayload([odd(Number.NaN)], 5).courses[0].difficulty).toBe(3);
  });

  it("sends the hours as given", () => {
    expect(buildPayload(rows, 7.5).total_available_hours).toBe(7.5);
  });

  it("starts a new row at difficulty 3 with no name or saved course", () => {
    expect(newRow("n1")).toEqual({ key: "n1", courseId: null, name: "", difficulty: 3 });
  });
});

describe("validatePlanInput", () => {
  const ok: PlannerRow[] = [{ key: "a", courseId: 1, name: "CSC 401", difficulty: 3 }];

  it("accepts a normal plan", () => {
    expect(validatePlanInput(ok, 12)).toEqual({});
    expect(validatePlanInput(ok, 1)).toEqual({});
    expect(validatePlanInput(ok, 168)).toEqual({});
  });

  it("rejects hours outside 1 to 168 and non-numbers", () => {
    for (const hours of [0, 0.5, 169, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validatePlanInput(ok, hours).hours, String(hours)).toBe("Enter a number of hours from 1 to 168.");
    }
  });

  it("needs at least one named course", () => {
    expect(validatePlanInput([], 10).courses).toBe("Add at least one course to plan.");
    expect(validatePlanInput([{ key: "a", courseId: null, name: " ", difficulty: 3 }], 10).courses).toBe(
      "Add at least one course to plan.",
    );
  });

  it("names a duplicate, ignoring case and spacing", () => {
    const rows: PlannerRow[] = [
      { key: "a", courseId: 1, name: "CSC 401", difficulty: 3 },
      { key: "b", courseId: null, name: " csc 401 ", difficulty: 3 },
    ];
    expect(validatePlanInput(rows, 10).courses).toBe('"csc 401" is listed twice. Keep one row for each course.');
  });

  it("allows at most 20 courses", () => {
    const rows = Array.from({ length: 21 }, (_, i): PlannerRow => ({ key: `k${i}`, courseId: null, name: `Course ${i}`, difficulty: 3 }));
    expect(validatePlanInput(rows, 40).courses).toBe("A plan can include up to 20 courses.");
    expect(validatePlanInput(rows.slice(0, 20), 40)).toEqual({});
  });

  it("reports hours and course problems together", () => {
    expect(Object.keys(validatePlanInput([], 0)).sort()).toEqual(["courses", "hours"]);
  });
});

describe("adjustment wording", () => {
  it("says where an adjustment came from", () => {
    expect(adjustmentText({ adjustment_source: "model" })).toBe("Adjusted from your forecast");
    expect(adjustmentText({ adjustment_source: "rule" })).toBe("Adjusted from your recent adherence");
    expect(adjustmentText({ adjustment_source: "none" })).toBe("No adjustment yet");
  });

  it("treats a missing source as no adjustment", () => {
    expect(adjustmentText({})).toBe("No adjustment yet");
  });

  it("counts a row as adjusted only when a source and a factor other than 1 are present", () => {
    expect(isAdjusted({ adjustment_source: "model", adherence_factor: 0.9 })).toBe(true);
    expect(isAdjusted({ adjustment_source: "rule", adherence_factor: 1.1 })).toBe(true);
    expect(isAdjusted({ adjustment_source: "model", adherence_factor: 1 })).toBe(false);
    expect(isAdjusted({ adjustment_source: "none", adherence_factor: 0.8 })).toBe(false);
    expect(isAdjusted({})).toBe(false);
  });

  it("words the adherence estimate when there is one", () => {
    expect(estimateText(0.724)).toBe("Expected adherence 72%");
    expect(estimateText(1.4)).toBe("Expected adherence 100%");
    expect(estimateText(0)).toBe("Expected adherence 0%");
    expect(estimateText(null)).toBeNull();
    expect(estimateText(undefined)).toBeNull();
    expect(estimateText(Number.NaN)).toBeNull();
  });
});

describe("hoursChanged", () => {
  it("is true only when the final hours differ from the difficulty split", () => {
    expect(hoursChanged({ allocated_hours: 6.9, base_hours: 8.1 })).toBe(true);
    expect(hoursChanged({ allocated_hours: 5, base_hours: 5 })).toBe(false);
    expect(hoursChanged({ allocated_hours: 5.02, base_hours: 5 })).toBe(false);
    expect(hoursChanged({ allocated_hours: 5.06, base_hours: 5 })).toBe(true);
    expect(hoursChanged({ allocated_hours: 5 })).toBe(false);
  });
});

describe("hoursText and findCourseByName", () => {
  it("shows whole hours plainly and others to one decimal", () => {
    expect(hoursText(6)).toBe("6 h");
    expect(hoursText(6.86)).toBe("6.9 h");
    expect(hoursText(2.5)).toBe("2.5 h");
    expect(hoursText(0)).toBe("0 h");
  });

  it("finds a saved course ignoring case and spacing", () => {
    const courses = [course(1, "CSC 401", 3), course(2, "MTH 401", 3)];
    expect(findCourseByName(courses, " csc 401 ")?.id).toBe(1);
    expect(findCourseByName(courses, "PHY 101")).toBeUndefined();
  });
});
