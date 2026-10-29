import { describe, expect, it } from "vitest";

import { COURSE_HUE_COUNT } from "./contrast";
import { buildCourseColorMap, colorFromMap, COURSE_HUES, courseColor } from "./course-colors";

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

describe("buildCourseColorMap", () => {
  const course = (id: number) => ({ id });

  it("gives the first 8 courses 8 different colours, even when their ids collide modulo 8", () => {
    const ids = [1, 9, 17, 25, 33, 41, 49, 57];
    expect(new Set(ids.map((id) => courseColor(id).index)).size).toBe(1); // the id-only colour collides
    const map = buildCourseColorMap(ids.map(course));
    expect(new Set([...map.values()].map((color) => color.index)).size).toBe(COURSE_HUE_COUNT);
  });

  it("hands colours out in id order, whatever order the list arrives in", () => {
    const sorted = buildCourseColorMap([course(4), course(10), course(22)]);
    const shuffled = buildCourseColorMap([course(22), course(4), course(10)]);
    expect(shuffled).toEqual(sorted);
    expect([4, 10, 22].map((id) => sorted.get(id)?.index)).toEqual([0, 1, 2]);
  });

  it("starts again after the 8th course", () => {
    const map = buildCourseColorMap(Array.from({ length: 10 }, (_, i) => course(i + 1)));
    expect(map.get(9)?.index).toBe(0);
    expect(map.get(10)?.index).toBe(1);
    expect(map.size).toBe(10);
  });

  it("uses the same theme-aware variables as courseColor", () => {
    const map = buildCourseColorMap([course(5)]);
    expect(map.get(5)?.style).toEqual(courseColor(0).style);
    expect(map.get(5)?.hue).toBe(COURSE_HUES[0]);
  });

  it("ignores duplicate ids and handles an empty list", () => {
    expect(buildCourseColorMap([]).size).toBe(0);
    const map = buildCourseColorMap([course(3), course(3), course(7)]);
    expect(map.size).toBe(2);
    expect(map.get(7)?.index).toBe(1);
  });
});

describe("colorFromMap", () => {
  it("returns the mapped colour, or the id-based colour for an unknown course", () => {
    const map = buildCourseColorMap([{ id: 9 }]);
    expect(colorFromMap(map, 9).index).toBe(0);
    expect(colorFromMap(map, 12)).toEqual(courseColor(12));
  });
});
