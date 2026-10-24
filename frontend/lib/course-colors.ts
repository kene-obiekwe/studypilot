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

/**
 * A stable colour for a course. Course ids are assigned sequentially, so id modulo the palette
 * size gives one user's courses different colours and never changes for a given id.
 */
export function courseColor(courseId: number): CourseColor {
  if (!Number.isFinite(courseId)) {
    throw new Error(`courseColor needs a numeric course id, got ${courseId}`);
  }
  const index = ((Math.trunc(courseId) % COURSE_HUE_COUNT) + COURSE_HUE_COUNT) % COURSE_HUE_COUNT;
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
