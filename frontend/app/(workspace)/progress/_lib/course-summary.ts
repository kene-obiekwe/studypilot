/** Per-course totals for the progress overview. Courses are grouped ignoring case and spacing. */

import type { SessionHistoryItem } from "@/lib/api";
import { courseKey } from "@/lib/courses";

export type CourseSummary = {
  key: string;
  /** The casing used by the course's most recent session. */
  label: string;
  sessions: number;
  /** Mean adherence from 0 to 1. */
  avgAdherence: number;
  loggedMinutes: number;
  plannedMinutes: number;
  /** Mean of the forecasts stored with the sessions, or null when none had one. */
  avgForecast: number | null;
};

export function summariseCourses(sessions: ReadonlyArray<SessionHistoryItem>): CourseSummary[] {
  const groups = new Map<
    string,
    CourseSummary & { latest: number; adherenceTotal: number; forecastTotal: number; forecastCount: number }
  >();
  for (const item of sessions) {
    const key = courseKey(item.course_name);
    const time = Date.parse(item.created_at);
    const stamp = Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: item.course_name.trim(),
        sessions: 0,
        avgAdherence: 0,
        loggedMinutes: 0,
        plannedMinutes: 0,
        avgForecast: null,
        latest: stamp,
        adherenceTotal: 0,
        forecastTotal: 0,
        forecastCount: 0,
      };
      groups.set(key, group);
    }
    group.sessions += 1;
    group.adherenceTotal += item.adherence_score;
    group.loggedMinutes += item.actual_minutes;
    group.plannedMinutes += item.planned_minutes;
    if (typeof item.predicted_adherence === "number") {
      group.forecastTotal += item.predicted_adherence;
      group.forecastCount += 1;
    }
    if (stamp > group.latest) {
      group.latest = stamp;
      group.label = item.course_name.trim();
    }
  }
  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      label: group.label,
      sessions: group.sessions,
      avgAdherence: group.adherenceTotal / group.sessions,
      loggedMinutes: group.loggedMinutes,
      plannedMinutes: group.plannedMinutes,
      avgForecast: group.forecastCount > 0 ? group.forecastTotal / group.forecastCount : null,
    }))
    .sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));
}

/** "28 h", "1.5 h" from minutes. */
export function hoursFromMinutes(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}
