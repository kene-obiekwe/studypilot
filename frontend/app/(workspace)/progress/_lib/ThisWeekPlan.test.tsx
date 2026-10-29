// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import type { WeeklyPlan } from "@/lib/api";
import { cleanup, render } from "@/test/dom";

import { ThisWeekPlan } from "./ThisWeekPlan";

// Wednesday 28 October 2026: this week starts Mon 26 Oct, next week Mon 2 Nov.
const NOW = new Date(2026, 9, 28, 12, 0);

function weekly(id: number, weekStart: string, total: number, course: string): WeeklyPlan {
  return {
    id,
    week_start: weekStart,
    revision: 1,
    revision_count: 1,
    is_current: true,
    superseded_at: null,
    created_at: "2026-10-28T12:00:00Z",
    updated_at: "2026-10-28T12:00:00Z",
    plan_json: {
      version: 2,
      mode: "first",
      made_on: "2026-10-28",
      total_hours: total,
      more_hours: total,
      counted_hours: 0,
      clamped: false,
      courses: [{ name: course, planned_hours: total }] as WeeklyPlan["plan_json"]["courses"],
      removed: [],
      total_available_hours: total,
      allocations: [],
    },
  };
}

afterEach(cleanup);

describe("ThisWeekPlan", () => {
  it("shows this week's plan even when next week's plan is the newest", async () => {
    const plans = [weekly(2, "2026-11-02", 12, "Next course"), weekly(1, "2026-10-26", 14, "This course")];
    const { container } = await render(<ThisWeekPlan plans={plans} now={NOW} />);
    expect(container.textContent).toContain("Week of 26 Oct");
    expect(container.textContent).toContain("14 h");
    expect(container.textContent).not.toContain("Week of 2 Nov");
    expect(container.textContent).toContain("Next week’s plan: 12 h, starts Mon 2 Nov");
  });

  it("has no next-week line when next week has no plan", async () => {
    const { container } = await render(<ThisWeekPlan plans={[weekly(1, "2026-10-26", 14, "A")]} now={NOW} />);
    expect(container.textContent).toContain("Week of 26 Oct");
    expect(container.textContent).not.toContain("Next week");
  });

  it("shows the no-plan state when only older plans exist", async () => {
    const { container } = await render(<ThisWeekPlan plans={[weekly(1, "2026-10-19", 14, "A")]} now={NOW} />);
    expect(container.textContent).toContain("No plan for this week yet. Make one in the planner.");
    expect(container.textContent).not.toContain("Week of");
  });

  it("says there are no plans at all when there are none", async () => {
    const { container } = await render(<ThisWeekPlan plans={[]} now={NOW} />);
    expect(container.textContent).toContain("No plans yet. Make one in the planner.");
  });

  it("shows next week's plan under the no-plan state", async () => {
    const { container } = await render(<ThisWeekPlan plans={[weekly(2, "2026-11-02", 12, "A")]} now={NOW} />);
    expect(container.textContent).toContain("No plan for this week yet.");
    expect(container.textContent).toContain("Next week’s plan: 12 h, starts Mon 2 Nov");
  });
});
