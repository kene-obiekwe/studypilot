import { describe, expect, it } from "vitest";

import { courseKey, groupByCourse } from "./courses";

const at = (course_name: string, created_at: string) => ({ course_name, created_at });

describe("courseKey", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(courseKey("  CSC 401 ")).toBe("csc 401");
    expect(courseKey("csc 401")).toBe(courseKey("Csc 401"));
  });

  it("keeps whitespace inside the name", () => {
    expect(courseKey("CSC  401")).not.toBe(courseKey("CSC 401"));
  });
});

describe("groupByCourse", () => {
  it("returns nothing for no sessions", () => {
    expect(groupByCourse([])).toEqual([]);
  });

  it("merges mixed casing and whitespace into one group", () => {
    const groups = groupByCourse([
      at("CSC 401", "2026-10-01T10:00:00Z"),
      at("csc 401", "2026-10-02T10:00:00Z"),
      at("  Csc 401  ", "2026-10-03T10:00:00Z"),
    ]);
    expect(groups).toEqual([{ key: "csc 401", label: "Csc 401", count: 3 }]);
  });

  it("labels each group with the casing of its most recent session, whatever the array order", () => {
    const newestFirst = groupByCourse([
      at("csc 401", "2026-10-03T10:00:00Z"),
      at("CSC 401", "2026-10-01T10:00:00Z"),
    ]);
    const oldestFirst = groupByCourse([
      at("CSC 401", "2026-10-01T10:00:00Z"),
      at("csc 401", "2026-10-03T10:00:00Z"),
    ]);
    expect(newestFirst[0].label).toBe("csc 401");
    expect(oldestFirst[0].label).toBe("csc 401");
  });

  it("keeps different courses apart and counts each", () => {
    const groups = groupByCourse([
      at("MTH 401", "2026-10-01T10:00:00Z"),
      at("CSC 401", "2026-10-02T10:00:00Z"),
      at("mth 401", "2026-10-03T10:00:00Z"),
    ]);
    expect(groups).toEqual([
      { key: "mth 401", label: "mth 401", count: 2 },
      { key: "csc 401", label: "CSC 401", count: 1 },
    ]);
  });

  it("returns groups in the order each course first appears", () => {
    const groups = groupByCourse([
      at("B", "2026-10-03T10:00:00Z"),
      at("A", "2026-10-02T10:00:00Z"),
      at("b", "2026-10-01T10:00:00Z"),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["b", "a"]);
  });

  it("keeps the first label on a timestamp tie and survives unparseable dates", () => {
    const tie = groupByCourse([at("CSC 401", "2026-10-01T10:00:00Z"), at("csc 401", "2026-10-01T10:00:00Z")]);
    expect(tie[0].label).toBe("CSC 401");
    const bad = groupByCourse([at("CSC 401", "not a date"), at("csc 401", "2026-10-01T10:00:00Z")]);
    expect(bad[0]).toEqual({ key: "csc 401", label: "csc 401", count: 2 });
  });
});
