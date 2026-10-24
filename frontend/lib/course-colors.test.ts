import { describe, expect, it } from "vitest";

import { COURSE_HUE_COUNT } from "./contrast";
import { COURSE_HUES, courseColor } from "./course-colors";

describe("courseColor", () => {
  it("is stable for a given id", () => {
    for (const id of [1, 7, 42, 1000, 123456]) {
      expect(courseColor(id)).toEqual(courseColor(id));
      expect(courseColor(id).index).toBe(id % COURSE_HUE_COUNT);
    }
  });

  it("gives consecutive ids (one user's new courses) different colours", () => {
    const indices = Array.from({ length: COURSE_HUE_COUNT }, (_, i) => courseColor(300 + i).index);
    expect(new Set(indices).size).toBe(COURSE_HUE_COUNT);
  });

  it("spreads any run of ids evenly across the palette", () => {
    const counts = new Array(COURSE_HUE_COUNT).fill(0);
    for (let id = 1; id <= 8000; id++) counts[courseColor(id).index]++;
    expect(counts).toEqual(new Array(COURSE_HUE_COUNT).fill(1000));
  });

  it("exposes theme-aware CSS variables for the chosen hue", () => {
    const color = courseColor(13);
    expect(color.index).toBe(5);
    expect(color.hue).toBe(COURSE_HUES[5]);
    expect(color.style).toEqual({
      "--course-dot": "var(--sp-course-5-dot)",
      "--course-tint": "var(--sp-course-5-tint)",
      "--course-ink": "var(--sp-course-5-ink)",
    });
  });

  it("handles 0, negative and fractional ids without leaving the palette", () => {
    expect(courseColor(0).index).toBe(0);
    expect(courseColor(-3).index).toBe(5);
    expect(courseColor(9.7).index).toBe(1);
  });

  it("rejects non-numbers", () => {
    expect(() => courseColor(Number.NaN)).toThrow();
  });
});
