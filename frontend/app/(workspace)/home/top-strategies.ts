import type { CourseRecommendation, CourseRecommendations } from "@/lib/api";
import { daysUntilExam } from "@/lib/exam";

export type TopStrategy = { course: CourseRecommendations["course"]; rec: CourseRecommendation };

/**
 * "This week's top 3". Each course's best strategy comes first (recommendations arrive sorted,
 * lower priority number = more important), courses ordered by the nearest exam; any slots left
 * are filled by priority across all courses. So one course can't take all three.
 */
export function pickTopStrategies(courses: CourseRecommendations[], now: Date, zone?: string, limit = 3): TopStrategy[] {
  const examRank = (entry: CourseRecommendations) => daysUntilExam(entry.course.exam_date, now, zone) ?? Number.POSITIVE_INFINITY;
  const ordered = courses
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.recommendations.length > 0)
    .sort((a, b) => examRank(a.entry) - examRank(b.entry) || a.index - b.index)
    .map(({ entry }) => entry);

  const firsts: TopStrategy[] = ordered.map((entry) => ({ course: entry.course, rec: entry.recommendations[0] }));
  if (firsts.length >= limit) return firsts.slice(0, limit);

  const rest = ordered
    .flatMap((entry) => entry.recommendations.slice(1).map((rec) => ({ course: entry.course, rec })))
    .map((item, index) => ({ item, index }))
    // Stable: equal priorities keep the exam order.
    .sort((a, b) => a.item.rec.priority - b.item.rec.priority || a.index - b.index)
    .map(({ item }) => item);
  return [...firsts, ...rest].slice(0, limit);
}
