export type CourseGroup = {
  /** Trimmed, lower-cased name that identifies the course. */
  key: string;
  /** The casing used by the course's most recent session. */
  label: string;
  count: number;
};

export function courseKey(name: string): string {
  return name.trim().toLowerCase();
}

type DatedCourseItem = { course_name: string; created_at: string };

/**
 * Group items by course, ignoring case and surrounding whitespace.
 * Groups are returned in the order their course first appears in `items`.
 */
export function groupByCourse(items: DatedCourseItem[]): CourseGroup[] {
  const groups = new Map<string, CourseGroup & { latest: number }>();
  for (const item of items) {
    const key = courseKey(item.course_name);
    const time = Date.parse(item.created_at);
    const stamp = Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { key, label: item.course_name.trim(), count: 1, latest: stamp });
      continue;
    }
    group.count += 1;
    if (stamp > group.latest) {
      group.latest = stamp;
      group.label = item.course_name.trim();
    }
  }
  return Array.from(groups.values(), ({ key, label, count }) => ({ key, label, count }));
}
