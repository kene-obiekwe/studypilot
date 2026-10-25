import { useMemo } from "react";

import { buildCourseColorMap, colorFromMap, type CourseColor } from "./course-colors";

/**
 * Colours for a user's course list. Pages that show several courses use this so no two of the
 * first 8 share a colour; `colorFor` falls back to the id-based colour for a course not in the list.
 * Pass a stable array (state, not a fresh array each render) so the map is not rebuilt every time.
 */
export function useCourseColors(courses: ReadonlyArray<{ id: number }>): { colorFor: (courseId: number) => CourseColor } {
  return useMemo(() => {
    const map = buildCourseColorMap(courses);
    return { colorFor: (courseId: number) => colorFromMap(map, courseId) };
  }, [courses]);
}
