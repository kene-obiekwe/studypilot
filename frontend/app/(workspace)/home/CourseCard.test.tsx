// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Course } from "@/lib/api";
import { courseColor } from "@/lib/course-colors";
import type { CourseWeekHours } from "@/lib/week";
import { cleanup, render } from "@/test/dom";

import { CourseCard } from "./CourseCard";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const COURSE = {
  id: 1,
  name: "Calculus",
  difficulty: 3,
  weekly_target_hours: 4,
  exam_date: null,
} as unknown as Course;

async function card(hours: CourseWeekHours | null) {
  const { container } = await render(
    <ul>
      <CourseCard
        course={COURSE}
        color={courseColor(1)}
        hours={hours}
        forecast={null}
        topRecommendation={null}
        timer={null}
        now={new Date(2026, 9, 28, 12)}
        onStart={() => undefined}
        onStop={() => undefined}
      />
    </ul>,
  );
  return container;
}

afterEach(cleanup);

describe("CourseCard hours", () => {
  it("shows progress and the hours left for a course in the plan", async () => {
    const container = await card({ logged: 4, planned: 10, remaining: 6, status: "in_plan" });
    expect(container.textContent).toContain("4 of 10 h");
    expect(container.textContent).toContain("6 h left");
    expect(container.textContent).not.toContain("Done for this week");
  });

  it("says Done for this week, with a check, once the planned hours are reached", async () => {
    const container = await card({ logged: 4, planned: 4, remaining: 0, status: "done" });
    expect(container.textContent).toContain("Done for this week");
    expect(container.textContent).toContain("4 of 4 h");
    expect(container.querySelector("li")?.className).toContain("cardDone");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("never says Done for an entry with 0 planned hours and nothing logged", async () => {
    const container = await card({ logged: 0, planned: 0, remaining: 0, status: "done" });
    expect(container.textContent).toContain("No hours planned this week");
    expect(container.textContent).not.toContain("Done for this week");
    expect(container.querySelector("li")?.className).not.toContain("cardDone");
  });

  it("keeps today's text for a course that is not in the plan", async () => {
    const container = await card({ logged: 1.5, planned: null, remaining: null, status: "not_in_plan" });
    expect(container.textContent).toContain("1.5 h logged this week · not in this week’s plan");
  });

  it("explains a removed course and that its hours are not counted", async () => {
    const container = await card({ logged: 1, planned: null, remaining: null, status: "removed" });
    expect(container.textContent).toContain("No longer in this week’s plan · 1 h logged, not counted");
  });

  it("copes with hours that could not be loaded", async () => {
    const container = await card(null);
    expect(container.textContent).toContain("Hours are unavailable right now.");
  });
});
