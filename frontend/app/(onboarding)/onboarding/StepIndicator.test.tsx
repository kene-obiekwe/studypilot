// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { cleanup, render } from "@/test/dom";

import { StepIndicator } from "./StepIndicator";

afterEach(cleanup);

describe("StepIndicator", () => {
  it("lists Courses, Plan and First session, and marks only the current step", async () => {
    const { container } = await render(<StepIndicator step={2} />);
    const items = [...container.querySelectorAll("li")];
    expect(items.map((item) => item.textContent?.replace(/\(done\)/, "").replace(/^\d/, "").trim())).toEqual([
      "Courses",
      "Plan",
      "First session",
    ]);
    expect(items.map((item) => item.getAttribute("aria-current"))).toEqual([null, "step", null]);
  });

  it("tells screen readers which steps are done", async () => {
    const { container } = await render(<StepIndicator step={3} />);
    const items = [...container.querySelectorAll("li")];
    expect(items[0].textContent).toContain("(done)");
    expect(items[1].textContent).toContain("(done)");
    expect(items[2].textContent).not.toContain("(done)");
    expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe("Setup progress");
  });
});
