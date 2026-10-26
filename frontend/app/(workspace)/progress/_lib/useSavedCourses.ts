"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { listCourses, type Course } from "@/lib/api";
import { courseKey } from "@/lib/courses";
import { useCourseColors } from "@/lib/use-course-colors";

const NO_COURSES: Course[] = [];

/**
 * The user's saved courses, for colours. History and forecasts carry only course names, so a name
 * is matched to a saved course ignoring case. A course that was deleted has no colour (the dot
 * falls back to a neutral grey). A failed request just leaves every dot grey.
 */
export function useSavedCourses(): { courses: Course[]; colorStyle: (courseName: string) => CSSProperties | undefined } {
  const [courses, setCourses] = useState<Course[]>(NO_COURSES);

  useEffect(() => {
    let cancelled = false;
    listCourses()
      .then((items) => {
        if (!cancelled) setCourses(items);
      })
      .catch(() => {
        // Colours are decoration; the pages work without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { colorFor } = useCourseColors(courses);
  const idsByName = useMemo(() => new Map(courses.map((course) => [courseKey(course.name), course.id])), [courses]);

  return {
    courses,
    colorStyle: (courseName: string) => {
      const id = idsByName.get(courseKey(courseName));
      return id === undefined ? undefined : colorFor(id).style;
    },
  };
}
