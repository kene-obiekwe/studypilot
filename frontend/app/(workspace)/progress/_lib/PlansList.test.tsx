// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import type { WeeklyPlan } from "@/lib/api";
import { cleanup, render } from "@/test/dom";

import { PlansList, weekTitle, type PlanRowData } from "./PlansList";

function weekly(id: number, weekStart: string, revisionCount: number, over: Partial<WeeklyPlan["plan_json"]> = {}): WeeklyPlan {
  return {
    id,
    week_start: weekStart,
    revision: revisionCount,
    revision_count: revisionCount,
    is_current: true,
    superseded_at: null,
    created_at: "2026-10-28T12:00:00Z",
    updated_at: "2026-10-28T12:00:00Z",
    plan_json: {
      version: 2,
      mode: "update",
      made_on: "2026-10-28",
      total_hours: 14,
      more_hours: 10,
      counted_hours: 4,
      clamped: false,
      courses: [
        { name: "A", planned_hours: 10 },
        { name: "C", planned_hours: 4 },
      ] as WeeklyPlan["plan_json"]["courses"],
      removed: [],
      total_available_hours: 14,
      allocations: [],
      ...over,
    },
  };
}

afterEach(cleanup);

describe("weekTitle", () => {
  it("names the week by its Monday", () => {
    expect(weekTitle("2026-10-26")).toBe("Week of 26 Oct");
    expect(weekTitle("2026-11-02")).toBe("Week of 2 Nov");
  });
});

describe("PlansList", () => {
  it("shows one row per week with its hours, courses and updates", async () => {
    const { container } = await render(<PlansList plans={[weekly(2, "2026-10-26", 3), weekly(1, "2026-10-19", 1)]} />);
    const rows = container.querySelectorAll("li.planRow, li[class*='planRow']");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Week of 26 Oct");
    expect(rows[0].textContent).toContain("14 h · 2 courses · updated 2 times");
    expect(rows[1].textContent).toContain("Week of 19 Oct");
    expect(rows[1].textContent).toContain("14 h · 2 courses");
    expect(rows[1].textContent).not.toContain("updated");
  });

  it("says updated 1 time for a plan with two revisions", async () => {
    const { container } = await render(<PlansList plans={[weekly(1, "2026-10-26", 2)]} />);
    expect(container.textContent).toContain("updated 1 time");
    expect(container.textContent).not.toContain("updated 1 times");
  });

  it("opens to per-course planned hours and the removed courses", async () => {
    const plan = weekly(1, "2026-10-26", 2, {
      removed: [{ course_id: 4, name: "B", removed_on: "2026-10-28", logged_hours: 1 }],
    });
    const { container } = await render(<PlansList plans={[plan]} />);
    const text = container.textContent ?? "";
    expect(text).toContain("A");
    expect(text).toContain("10 h");
    expect(text).toContain("4 h");
    expect(text).toContain("No longer in this week’s plan: B · 1 h logged (not counted)");
  });

  it("still reads a first-version history item, titled by its week", async () => {
    const legacy: PlanRowData = {
      id: 9,
      week_start: "2026-10-12",
      created_at: "2026-10-14T09:00:00Z",
      plan_json: { allocations: [{ course: "Calculus", allocated_hours: 7.5 }], total_available_hours: 7.5 },
    };
    const { container } = await render(<PlansList plans={[legacy]} />);
    expect(container.textContent).toContain("Week of 12 Oct");
    expect(container.textContent).toContain("7.5 h · 1 course");
    expect(container.textContent).toContain("Calculus");
  });
});
