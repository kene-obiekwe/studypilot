import { describe, expect, it } from "vitest";

import type { CourseRecommendation, CourseRecommendations } from "@/lib/api";

import { pickTopStrategies } from "./top-strategies";

const NOW = new Date(2026, 9, 22, 12);

function rec(id: string, priority: number): CourseRecommendation {
  return {
    shown_id: priority * 100 + id.length,
    strategy_id: id,
    kind: "practice",
    priority,
    basis: "settings",
    title: id,
    what: "",
    how: [],
    why: "",
    triggers: [],
    facts: {},
    source: { citation: "", short: "" },
    feedback: { rating: null, tried: false },
  } as unknown as CourseRecommendation;
}

function course(id: number, examDate: string | null, recs: CourseRecommendation[]): CourseRecommendations {
  return {
    course: { id, name: `C${id}`, difficulty: 3, learning_demands: [], builds_on_earlier: null, assessment_format: null, exam_date: examDate },
    evidence: {} as CourseRecommendations["evidence"],
    recommendations: recs,
    saved_plan: null,
  };
}

const ids = (picked: ReturnType<typeof pickTopStrategies>) => picked.map(({ course: c, rec: r }) => `${c.id}:${r.strategy_id}`);

describe("top strategies", () => {
  it("takes each course's best first, nearest exam first", () => {
    const courses = [
      course(1, null, [rec("a", 1), rec("b", 2)]),
      course(2, "2026-11-01", [rec("c", 3)]),
      course(3, "2026-10-25", [rec("d", 5)]),
      course(4, null, [rec("e", 1)]),
    ];
    expect(ids(pickTopStrategies(courses, NOW))).toEqual(["3:d", "2:c", "1:a"]);
  });

  it("fills the remaining slots by priority", () => {
    const courses = [course(1, null, [rec("a", 1), rec("b", 4), rec("c", 6)]), course(2, null, [rec("d", 2), rec("e", 3)])];
    expect(ids(pickTopStrategies(courses, NOW))).toEqual(["1:a", "2:d", "2:e"]);
  });

  it("skips courses without recommendations and ignores past exams", () => {
    const courses = [course(1, "2026-10-01", [rec("a", 1)]), course(2, "2026-10-30", []), course(3, null, [rec("b", 1)])];
    expect(ids(pickTopStrategies(courses, NOW))).toEqual(["1:a", "3:b"]);
    expect(pickTopStrategies([], NOW)).toEqual([]);
  });
});
