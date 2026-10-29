// @vitest-environment jsdom
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMe, getSessionHistory, listPlans, type SessionHistoryItem, type WeeklyPlan } from "@/lib/api";
import { cleanup, render } from "@/test/dom";

import { ShellDataProvider } from "./ShellData";
import { WeekMeter } from "./WeekMeter";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getMe: vi.fn(),
  listPlans: vi.fn(),
  getSessionHistory: vi.fn(),
}));

// The meter reads the real clock, so plans and sessions are built for the current week.
function startOfWeek(): Date {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function key(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function planFor(courses: Array<[string, number]>): WeeklyPlan {
  const monday = key(startOfWeek());
  return {
    id: 1,
    week_start: monday,
    revision: 1,
    revision_count: 1,
    is_current: true,
    superseded_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    plan_json: {
      version: 2,
      mode: "first",
      made_on: monday,
      total_hours: courses.reduce((sum, [, hours]) => sum + hours, 0),
      more_hours: 0,
      counted_hours: 0,
      clamped: false,
      courses: courses.map(([name, hours]) => ({
        course_id: 1,
        name,
        difficulty: 3,
        factor: 1,
        adjustment_source: "none" as const,
        adherence_estimate: null,
        entered_on: monday,
        logged_at_revision: 0,
        remaining_at_revision: hours,
        planned_hours: hours,
        focus_block_minutes: 50,
        break_minutes: 10,
      })),
      removed: [],
      total_available_hours: 0,
      allocations: [],
    },
  };
}

function session(course: string, minutes: number): SessionHistoryItem {
  // One minute past Monday 00:00 is always in the past by the time the meter reads it.
  const at = startOfWeek();
  at.setMinutes(at.getMinutes() + 1);
  return {
    id: minutes,
    course_name: course,
    planned_minutes: minutes,
    actual_minutes: minutes,
    focus_score: 0.7,
    completion_rate: 0.7,
    adherence_score: 1,
    predicted_adherence: null,
    model_version: "",
    created_at: at.toISOString(),
  };
}

async function meter(plans: WeeklyPlan[], sessions: SessionHistoryItem[]) {
  vi.mocked(getMe).mockResolvedValue({ id: 1, username: "u", email: "u@example.com" });
  vi.mocked(listPlans).mockResolvedValue(plans);
  vi.mocked(getSessionHistory).mockResolvedValue({ items: sessions });
  const { container } = await render(
    <ShellDataProvider>
      <Suspense fallback={<p>loading</p>}>
        <WeekMeter />
      </Suspense>
    </ShellDataProvider>,
  );
  return container;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WeekMeter", () => {
  it("counts only courses in the plan and says how much it left out", async () => {
    const container = await meter([planFor([["A", 4]])], [session("A", 60), session("B", 60)]);
    expect(container.textContent).toContain("1 of 4 h");
    expect(container.textContent).toContain("Excludes 1 h on courses not in this week’s plan.");
  });

  it("has no exclusion caption when every logged hour counts", async () => {
    const container = await meter([planFor([["A", 4]])], [session("A", 60)]);
    expect(container.textContent).toContain("1 of 4 h");
    expect(container.textContent).not.toContain("Excludes");
  });

  it("counts everything, and says there is no plan, when the week has none", async () => {
    const container = await meter([], [session("A", 90)]);
    expect(container.textContent).toContain("1.5 h logged, no plan yet");
    expect(container.textContent).toContain("No plan for this week yet.");
    expect(container.textContent).not.toContain("Excludes");
  });
});
