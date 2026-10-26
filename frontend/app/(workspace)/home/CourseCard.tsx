"use client";

import Link from "next/link";
import { ChevronRight, Play, Square } from "lucide-react";

import { ElapsedTime } from "@/components/timer";
import { Badge, Button, ProgressBar } from "@/components/ui";
import type { Course, CourseEvidence, CourseRecommendation } from "@/lib/api";
import type { CourseColor } from "@/lib/course-colors";
import { examLabel } from "@/lib/exam";
import type { TimerState } from "@/lib/timer";
import { formatHours } from "@/lib/week";

import styles from "./home.module.css";

export function CourseCard({
  course,
  color,
  hours,
  forecast,
  topRecommendation,
  timer,
  now,
  onStart,
  onStop,
}: {
  course: Course;
  color: CourseColor;
  /** null when the session history couldn't be loaded. */
  hours: { loggedHours: number; plannedHours: number | null } | null;
  forecast: CourseEvidence["forecast"] | null;
  topRecommendation: CourseRecommendation | null;
  /** The running timer, whichever course it is for. */
  timer: TimerState | null;
  now: Date;
  onStart: () => void;
  onStop: () => void;
}) {
  const exam = examLabel(course.exam_date, now);
  const headingId = `course-card-${course.id}`;
  const running = timer?.courseId === course.id ? timer : null;

  return (
    // The course colour variables feed the dot and the progress fill.
    <li className={styles.card} style={color.style} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h3 id={headingId} className={styles.cardTitle}>
          <span className={styles.dot} aria-hidden="true" />
          {course.name}
        </h3>
        <div className={styles.badges}>
          {forecast && <ForecastBadge forecast={forecast} />}
          {exam && <Badge tone="exam">{exam}</Badge>}
        </div>
      </div>

      {hours === null ? (
        <p className={styles.muted}>Hours are unavailable right now.</p>
      ) : hours.plannedHours !== null ? (
        <ProgressBar
          label="This week"
          value={hours.loggedHours}
          max={hours.plannedHours}
          valueText={`${formatHours(hours.loggedHours)} of ${formatHours(hours.plannedHours)} h`}
        />
      ) : (
        <p className={styles.muted}>
          {formatHours(hours.loggedHours)} h logged this week · not in this week&rsquo;s plan
        </p>
      )}

      {topRecommendation && (
        <Link href="/strategies" className={styles.topRec}>
          <span className={styles.topRecText}>
            <span className={styles.srOnly}>Top strategy: </span>
            {topRecommendation.title}
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      )}

      <div className={styles.cardActions}>
        {running ? (
          <Button size="sm" icon={<Square size={14} />} onClick={onStop} aria-label={`Stop the ${course.name} timer`}>
            Stop · <ElapsedTime timer={running} />
          </Button>
        ) : (
          <Button size="sm" icon={<Play size={14} />} onClick={onStart} aria-label={`Start a timer for ${course.name}`}>
            Start timer
          </Button>
        )}
      </div>
    </li>
  );
}

function ForecastBadge({ forecast }: { forecast: CourseEvidence["forecast"] }) {
  if (forecast.status === "ok" && forecast.predicted_adherence !== null) {
    const percent = Math.round(forecast.predicted_adherence * 100);
    return (
      <Badge tone="accent" title="Forecast adherence for next week">
        <span className={styles.srOnly}>Forecast adherence </span>
        {percent}%<span aria-hidden="true"> forecast</span>
      </Badge>
    );
  }
  return <Badge tone="neutral">Not enough history yet</Badge>;
}
