"use client";

import type { CSSProperties } from "react";

import { Card } from "@/components/ui";
import type { CourseColor } from "@/lib/course-colors";
import { formatMinutes, formatMinutesShort, type StripDay } from "@/lib/week";

import styles from "./home.module.css";

/** Minutes for an empty week's scale, so a single short session doesn't fill the whole bar. */
const MIN_SCALE_MINUTES = 60;

/**
 * Mon–Sun, minutes logged per day stacked by course colour. The bars are decorative
 * (aria-hidden); the same numbers are in a visually hidden table for screen readers.
 */
export function WeekStrip({ days, colorFor }: { days: StripDay[]; colorFor: (courseId: number) => CourseColor }) {
  const scale = Math.max(MIN_SCALE_MINUTES, ...days.map((day) => day.minutes));
  const total = days.reduce((sum, day) => sum + day.minutes, 0);
  const legend = new Map<number | null, string>();
  days.forEach((day) => day.segments.forEach((segment) => legend.set(segment.courseId, segment.courseName)));

  const segmentStyle = (courseId: number | null, minutes: number): CSSProperties => ({
    ...(courseId === null ? {} : colorFor(courseId).style),
    height: `${(minutes / scale) * 100}%`,
  });

  return (
    <Card as="section" aria-labelledby="strip-heading" className={styles.strip}>
      <div className={styles.stripHead}>
        <h2 id="strip-heading" className={styles.sectionTitle}>
          This week&rsquo;s study
        </h2>
        <p className={styles.muted}>{formatMinutes(total)} logged</p>
      </div>

      <div className={styles.stripDays} aria-hidden="true">
        {days.map((day) => (
          <div key={day.date} className={day.isToday ? `${styles.stripDay} ${styles.stripToday}` : styles.stripDay}>
            <div className={styles.stripTrack}>
              {day.segments.map((segment) => (
                <span
                  key={segment.courseId ?? "other"}
                  className={segment.courseId === null ? `${styles.stripSegment} ${styles.stripOther}` : styles.stripSegment}
                  style={segmentStyle(segment.courseId, segment.minutes)}
                />
              ))}
            </div>
            <span className={styles.stripLabel}>{day.label}</span>
            <span className={styles.stripMinutes}>{day.minutes > 0 ? formatMinutesShort(day.minutes) : "–"}</span>
          </div>
        ))}
      </div>

      {legend.size > 0 && (
        <ul className={styles.legend} aria-hidden="true">
          {[...legend].map(([courseId, name]) => (
            <li key={courseId ?? "other"} style={courseId === null ? undefined : colorFor(courseId).style}>
              <span className={courseId === null ? `${styles.dot} ${styles.dotOther}` : styles.dot} />
              {name}
            </li>
          ))}
        </ul>
      )}

      {/* A table ignores width/height, so the screen-reader-only clipping goes on a wrapper. */}
      <div className={styles.srOnly}>
        <table>
          <caption>Minutes logged each day this week</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Total</th>
              <th scope="col">By course</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <th scope="row">
                  {day.label}
                  {day.isToday ? " (today)" : ""}
                </th>
                <td>{formatMinutes(day.minutes)}</td>
                <td>
                  {day.segments.length === 0
                    ? "Nothing logged"
                    : day.segments.map((segment) => `${segment.courseName} ${formatMinutes(segment.minutes)}`).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
