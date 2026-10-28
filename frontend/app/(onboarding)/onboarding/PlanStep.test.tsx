// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, PlanExistsError, savePlan, type Course, type WeeklyPlanDetail } from "@/lib/api";
import { courseColor } from "@/lib/course-colors";
import { cleanup, click, render } from "@/test/dom";

import { PlanStep } from "./PlanStep";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  savePlan: vi.fn(),
}));

const COURSES = [
  { id: 1, name: "Calculus", difficulty: 4 },
  { id: 2, name: "History", difficulty: 2 },
] as unknown as Course[];

// Wednesday 28 October 2026 and Sunday 1 November 2026, local time.
const WEDNESDAY = new Date(2026, 9, 28, 12);
const SUNDAY = new Date(2026, 10, 1, 20);

function saved(weekStart: string): WeeklyPlanDetail {
  return {
    id: 1,
    week_start: weekStart,
    revision: 1,
    revision_count: 1,
    is_current: true,
    superseded_at: null,
    created_at: "2026-10-28T12:00:00Z",
    updated_at: "2026-10-28T12:00:00Z",
    days_left: 5,
    plan_json: {
      version: 2,
      mode: "first",
      made_on: "2026-10-28",
      total_hours: 10,
      more_hours: 10,
      counted_hours: 0,
      clamped: false,
      courses: [
        { name: "Calculus", planned_hours: 6.67 },
        { name: "History", planned_hours: 3.33 },
      ] as WeeklyPlanDetail["plan_json"]["courses"],
      removed: [],
      total_available_hours: 10,
      allocations: [],
    },
  };
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`No button "${text}"`);
  return found as HTMLButtonElement;
}

async function step(now: Date, handlers: { onSaved?: () => void; onContinue?: () => void } = {}) {
  const { container } = await render(
    <PlanStep
      courses={COURSES}
      colorFor={courseColor}
      onSaved={handlers.onSaved ?? (() => undefined)}
      onContinue={handlers.onContinue ?? (() => undefined)}
      now={now}
    />,
  );
  return container;
}

beforeEach(() => {
  vi.mocked(savePlan).mockReset();
});

afterEach(cleanup);

describe("PlanStep", () => {
  it("makes the week's first plan: this week's Monday, the total, base_revision null", async () => {
    vi.mocked(savePlan).mockResolvedValue(saved("2026-10-26"));
    const onSaved = vi.fn();
    const container = await step(WEDNESDAY, { onSaved });
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();

    await click(button(container, "Make my plan"));

    expect(savePlan).toHaveBeenCalledWith("2026-10-26", {
      courses: [
        { name: "Calculus", difficulty: 4 },
        { name: "History", difficulty: 2 },
      ],
      total_hours: 10,
      base_revision: null,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Your plan for this week");
    expect(container.textContent).toContain("Calculus6.7 h");
    expect(button(container, "Continue")).toBeTruthy();
  });

  it("on a Sunday offers the week and defaults to next week", async () => {
    vi.mocked(savePlan).mockResolvedValue(saved("2026-11-02"));
    const container = await step(SUNDAY);

    const choices = Array.from(container.querySelectorAll('[role="radio"]'));
    expect(choices.map((item) => item.textContent)).toEqual(["This week (ends today)", "Next week (starts Mon 2 Nov)"]);
    expect(choices.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "true"]);

    await click(button(container, "Make my plan"));
    expect(vi.mocked(savePlan).mock.calls[0][0]).toBe("2026-11-02");
    expect(container.textContent).toContain("Your plan for next week");
  });

  it("on a Sunday can plan the week that ends today", async () => {
    vi.mocked(savePlan).mockResolvedValue(saved("2026-10-26"));
    const container = await step(SUNDAY);

    await click(button(container, "This week (ends today)"));
    await click(button(container, "Make my plan"));
    expect(vi.mocked(savePlan).mock.calls[0][0]).toBe("2026-10-26");
  });

  it("leaves an existing plan alone and lets the user continue", async () => {
    vi.mocked(savePlan).mockRejectedValue(
      new PlanExistsError(new ApiError(409, "This week already has a plan.", {}, "plan_exists")),
    );
    const onContinue = vi.fn();
    const container = await step(WEDNESDAY, { onContinue });

    await click(button(container, "Make my plan"));

    expect(container.textContent).toContain("You already have this week's plan");
    expect(container.querySelector("form")).toBeNull();
    await click(button(container, "Continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows any other failure and lets the user try again", async () => {
    vi.mocked(savePlan).mockRejectedValue(new Error("Server is down"));
    const container = await step(WEDNESDAY);

    await click(button(container, "Make my plan"));

    expect(container.textContent).toContain("Could not save your plan");
    expect(container.textContent).toContain("Server is down");
    expect(button(container, "Make my plan").disabled).toBe(false);
  });
});
