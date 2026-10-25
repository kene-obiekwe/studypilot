import type { CSSProperties } from "react";

import { COURSE_HUE_COUNT } from "./contrast";

export const COURSE_HUES = ["indigo", "teal", "green", "violet", "rose", "cyan", "olive", "clay"] as const;
export type CourseHue = (typeof COURSE_HUES)[number];

export type CourseColor = {
  index: number;
  hue: CourseHue;
  /**
   * Set on an element to give it (and its children) this course's colours as
   * --course-dot, --course-tint and --course-ink. Theme-aware: the values follow data-theme.
   */
  style: CSSProperties;
};

function colorAt(index: number): CourseColor {
  return {
    index,
    hue: COURSE_HUES[index],
    style: {
      "--course-dot": `var(--sp-course-${index}-dot)`,
      "--course-tint": `var(--sp-course-${index}-tint)`,
      "--course-ink": `var(--sp-course-${index}-ink)`,
    } as CSSProperties,
  };
}

/**
 * A stable colour for a course id alone: id modulo the palette size. Two of a user's courses can
 * share a colour this way (ids 1 and 9), so prefer `buildCourseColorMap` when you have the list.
 */
export function courseColor(courseId: number): CourseColor {
  if (!Number.isFinite(courseId)) {
    throw new Error(`courseColor needs a numeric course id, got ${courseId}`);
  }
  return colorAt(((Math.trunc(courseId) % COURSE_HUE_COUNT) + COURSE_HUE_COUNT) % COURSE_HUE_COUNT);
}

/**
 * Colours for one user's courses: sorted by id, then handed out in palette order, so the first
 * 8 courses never share a colour (a 9th reuses the first). The result does not depend on the
 * order of `courses`. Deleting a course moves the colours of the courses added after it.
 */
export function buildCourseColorMap(courses: ReadonlyArray<{ id: number }>): Map<number, CourseColor> {
  const map = new Map<number, CourseColor>();
  const ids = [...new Set(courses.map((course) => course.id))].sort((a, b) => a - b);
  ids.forEach((id, position) => map.set(id, colorAt(position % COURSE_HUE_COUNT)));
  return map;
}

/** The colour from a map built by `buildCourseColorMap`, or the id-based colour for an unknown id. */
export function colorFromMap(map: ReadonlyMap<number, CourseColor>, courseId: number): CourseColor {
  return map.get(courseId) ?? courseColor(courseId);
}
