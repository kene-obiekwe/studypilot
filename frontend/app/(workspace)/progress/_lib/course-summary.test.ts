import { describe, expect, it } from "vitest";

import type { SessionHistoryItem } from "@/lib/api";

import { hoursFromMinutes, summariseCourses } from "./course-summary";
import { activeTab } from "./ProgressTabs";

let id = 1;
const session = (course_name: string, created_at: string, adherence_score: number, actual: number, planned: number, predicted: number | null = null): SessionHistoryItem => ({
  id: id++,
  course_name,
  planned_minutes: planned,
  actual_minutes: actual,
  focus_score: 0.5,
  completion_rate: 0.5,
  adherence_score,
  predicted_adherence: predicted,
  model_version: "",
  created_at,
});

describe("summariseCourses", () => {
  it("groups mixed casing and spacing into one course labelled by its latest session", () => {
    const result = summariseCourses([
      session("CSC 401", "2026-10-01T10:00:00Z", 0.5, 30, 60),
      session("csc 401", "2026-10-03T10:00:00Z", 1, 60, 60),
      session(" Csc 401 ", "2026-10-02T10:00:00Z", 0.75, 45, 60),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("csc 401");
    expect(result[0].sessions).toBe(3);
    expect(result[0].avgAdherence).toBeCloseTo(0.75);
    expect(result[0].loggedMinutes).toBe(135);
    expect(result[0].plannedMinutes).toBe(180);
  });

  it("averages only the forecasts that exist", () => {
    const [course] = summariseCourses([
      session("A", "2026-10-01T10:00:00Z", 0.5, 1, 2, 0.6),
      session("A", "2026-10-02T10:00:00Z", 0.5, 1, 2, null),
      session("A", "2026-10-03T10:00:00Z", 0.5, 1, 2, 0.8),
    ]);
    expect(course.avgForecast).toBeCloseTo(0.7);
    expect(summariseCourses([session("B", "2026-10-01T10:00:00Z", 0.5, 1, 2)])[0].avgForecast).toBeNull();
  });

  it("lists the most logged course first, then by name", () => {
    const result = summariseCourses([
      session("B", "2026-10-01T10:00:00Z", 1, 1, 1),
      session("A", "2026-10-01T10:00:00Z", 1, 1, 1),
      session("C", "2026-10-01T10:00:00Z", 1, 1, 1),
      session("C", "2026-10-02T10:00:00Z", 1, 1, 1),
    ]);
    expect(result.map((course) => course.label)).toEqual(["C", "A", "B"]);
  });

  it("handles no sessions", () => {
    expect(summariseCourses([])).toEqual([]);
  });
});

describe("hoursFromMinutes", () => {
  it("rounds to one decimal", () => {
    expect(hoursFromMinutes(60)).toBe("1 h");
    expect(hoursFromMinutes(90)).toBe("1.5 h");
    expect(hoursFromMinutes(1677)).toBe("28 h");
    expect(hoursFromMinutes(0)).toBe("0 h");
  });
});

describe("activeTab", () => {
  it("marks Overview only on /progress itself", () => {
    expect(activeTab("/progress")).toBe("/progress");
    expect(activeTab("/progress/")).toBe("/progress");
  });

  it("marks the other sections on their path and sub-paths", () => {
    expect(activeTab("/progress/log")).toBe("/progress/log");
    expect(activeTab("/progress/history")).toBe("/progress/history");
    expect(activeTab("/progress/predict")).toBe("/progress/predict");
    expect(activeTab("/progress/history/extra")).toBe("/progress/history");
  });

  it("marks nothing elsewhere", () => {
    expect(activeTab("/planner")).toBeUndefined();
    expect(activeTab(null)).toBeUndefined();
  });
});
