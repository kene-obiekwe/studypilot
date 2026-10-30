"use client";

import Link from "next/link";
import { Check, ChevronRight, Play, Square } from "lucide-react";

import { ElapsedTime } from "@/components/timer";
import { Badge, Button, ProgressBar } from "@/components/ui";
import type { Course, CourseEvidence, CourseRecommendation } from "@/lib/api";
import type { CourseColor } from "@/lib/course-colors";
import { examLabel } from "@/lib/exam";
import type { TimerState } from "@/lib/timer";
import { formatHours, type CourseWeekHours } from "@/lib/week";

import styles from "./home.module.css";

export function CourseCard({
  course,
  color,
  hours,
  forecast,
  topRecommendation,
  timer,
  now,
  zone,
  onStart,
  onStop,
}: {
  course: Course;
  color: CourseColor;
  /** null when the session history couldn't be loaded. */
  hours: CourseWeekHours | null;
  forecast: CourseEvidence["forecast"] | null;
  topRecommendation: CourseRecommendation | null;
  /** The running timer, whichever course it is for. */
  timer: TimerState | null;
  now: Date;
  /** The zone that decides today for the exam badge; the browser's when omitted. */
  zone?: string;
  onStart: () => void;
  onStop: () => void;
}) {
  const exam = examLabel(course.exam_date, now, zone);
  const headingId = `course-card-${course.id}`;
  const running = timer?.courseId === course.id ? timer : null;

  return (
    // The course colour variables feed the dot and the progress fill.
    <li
      className={`${styles.card} ${hours?.status === "done" && hours.planned ? styles.cardDone : ""}`}
      style={color.style}
      aria-labelledby={headingId}
    >
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

      <WeekHours hours={hours} />

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

/** The course's line for this week: progress, "Done for this week", or why there is none. */
function WeekHours({ hours }: { hours: CourseWeekHours | null }) {
  if (hours === null) return <p className={styles.muted}>Hours are unavailable right now.</p>;
  const { logged, planned, remaining, status } = hours;

  // A plan that gives the course no hours is not "done": there was nothing to do.
  if (status === "done" && !planned) {
    return (
      <p className={styles.muted}>
        No hours planned this week{logged > 0 ? ` · ${formatHours(logged)} h logged` : ""}
      </p>
    );
  }
  if (status === "done" && planned) {
    return (
      <div className={styles.hours}>
        <Badge tone="success" icon={<Check size={12} aria-hidden="true" />}>
          Done for this week
        </Badge>
        <p className={styles.muted}>
          {formatHours(logged)} of {formatHours(planned)} h
        </p>
      </div>
    );
  }
  if (status === "in_plan" && planned) {
    return (
      <div className={styles.hours}>
        <ProgressBar
          label="This week"
          value={logged}
          max={planned}
          valueText={`${formatHours(logged)} of ${formatHours(planned)} h`}
        />
        <p className={styles.muted}>{formatHours(remaining ?? 0)} h left</p>
      </div>
    );
  }
  if (status === "removed") {
    return (
      <p className={styles.muted}>
        No longer in this week&rsquo;s plan · {formatHours(logged)} h logged, not counted
      </p>
    );
  }
  return (
    <p className={styles.muted}>
      {formatHours(logged)} h logged this week · not in this week&rsquo;s plan
    </p>
  );
}
