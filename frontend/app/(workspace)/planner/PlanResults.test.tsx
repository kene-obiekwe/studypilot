// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { cleanup, render } from "@/test/dom";

import { PlanResults } from "./PlanResults";
import type { PlanAllocation } from "./plan-model";

afterEach(cleanup);

const base = { focus_block_minutes: 50, break_minutes: 10 };
const ALLOCATIONS: PlanAllocation[] = [
  { course: "CSC 401", allocated_hours: 6.9, base_hours: 8.1, adherence_factor: 0.9, adjustment_source: "model", adherence_estimate: 0.63, ...base },
  { course: "MTH 401", allocated_hours: 5.1, base_hours: 5.1, adherence_factor: 1, adjustment_source: "rule", adherence_estimate: 0.78, ...base },
  { course: "STA 401", allocated_hours: 4, base_hours: 4, adherence_factor: 0.9, adjustment_source: "model", adherence_estimate: 0.66, ...base },
  { course: "ENG 401", allocated_hours: 0, adjustment_source: "none", adherence_estimate: null, ...base },
];

describe("PlanResults", () => {
  it("shows one row per course with its hours", async () => {
    const { container } = await render(<PlanResults allocations={ALLOCATIONS} />);
    const rows = [...container.querySelectorAll("li")];
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("CSC 401");
    expect(rows[0].textContent).toContain("6.9 h");
  });

  it("says where each adjustment came from, in plain words", async () => {
    const { container } = await render(<PlanResults allocations={ALLOCATIONS} />);
    const [model, rule, , none] = [...container.querySelectorAll("li")].map((row) => row.textContent ?? "");
    expect(model).toContain("Adjusted from your forecast");
    expect(rule).toContain("Adjusted from your recent adherence");
    expect(none).toContain("No adjustment yet");
  });

  it("shows the base hours and factor only when the hours were adjusted", async () => {
    const { container } = await render(<PlanResults allocations={ALLOCATIONS} />);
    const [adjusted, unchanged] = [...container.querySelectorAll("li")].map((row) => row.textContent ?? "");
    expect(adjusted).toContain("from 8.1 h by difficulty");
    expect(adjusted).toContain("Weight ×0.9");
    expect(unchanged).not.toContain("by difficulty");
    expect(unchanged).not.toContain("Weight ×");
  });

  it("does not claim a change in hours when the adjustment left them as they were", async () => {
    const { container } = await render(<PlanResults allocations={ALLOCATIONS} />);
    const same = [...container.querySelectorAll("li")][2].textContent ?? "";
    expect(same).toContain("Adjusted from your forecast");
    expect(same).toContain("Weight ×0.9");
    expect(same).not.toContain("by difficulty");
  });

  it("shows the adherence estimate when there is one", async () => {
    const { container } = await render(<PlanResults allocations={ALLOCATIONS} />);
    const [first, second, , third] = [...container.querySelectorAll("li")].map((row) => row.textContent ?? "");
    expect(first).toContain("Expected adherence 63%");
    expect(second).toContain("Expected adherence 78%");
    expect(third).not.toContain("Expected adherence");
  });

  it("describes each share of the plan to assistive technology", async () => {
    const { container } = await render(<PlanResults allocations={ALLOCATIONS} />);
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute("aria-valuetext")).toBe("6.9 h of 16 h");
  });
});
