"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";

import { PageAction } from "@/components/app-shell";
import { Button, EmptyState, Notice, ProgressBar, Skeleton, Stat } from "@/components/ui";
import { listPlans, type WeeklyPlan } from "@/lib/api";

import { hoursFromMinutes, summariseCourses } from "./_lib/course-summary";
import { percentText, shortDate } from "./_lib/history-model";
import { PlanWeekRow } from "./_lib/PlansList";
import styles from "./_lib/progress.module.css";
import { useProgress } from "./_lib/shared";
import { useSavedCourses } from "./_lib/useSavedCourses";

const RECENT_SESSIONS = 5;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LatestPlan = { plan: WeeklyPlan | null } | { error: string };

/** Never rejects: the newest week's plan, or why it couldn't be loaded. */
function loadLatestPlan(): Promise<LatestPlan> {
  return listPlans(1).then(
    (plans) => ({ plan: plans[0] ?? null }),
    (failure: Error) => ({ error: failure.message }),
  );
}

export default function ProgressOverviewPage() {
  const router = useRouter();
  const { sessions, analytics, isLoading, error, refresh } = useProgress();
  const [latestPromise, setLatestPromise] = useState(loadLatestPlan);
  const { colorStyle } = useSavedCourses();
  const summaries = useMemo(() => summariseCourses(sessions), [sessions]);

  const recent = sessions.slice(0, RECENT_SESSIONS);
  const loading = isLoading && sessions.length === 0;

  return (
    <div className={styles.page}>
      <PageAction>
        <Button variant="primary" icon={<ClipboardCheck size={16} />} onClick={() => router.push("/progress/log")}>
          Log a session
        </Button>
      </PageAction>

      {error && (
        <Notice tone="danger" title="Could not load your progress">
          {error}{" "}
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            Try again
          </Button>
        </Notice>
      )}

      {loading && (
        <div className={styles.stats} aria-busy="true" aria-label="Loading your progress">
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <EmptyState
          title="No sessions logged yet"
          description="Log a session and your adherence, focus and forecast will show up here."
          action={
            <Link href="/progress/log" className={styles.link}>
              Log your first session
            </Link>
          }
        />
      )}

      {sessions.length > 0 && (
        <>
          <section className={styles.stats} aria-label="Totals across all sessions">
            <Stat label="Average adherence" value={pct(analytics.avgAdherence)} hint={`Across ${sessions.length} sessions`} />
            <Stat
              label="Forecast average"
              value={analytics.avgPredicted > 0 ? pct(analytics.avgPredicted) : "n/a"}
              hint={analytics.avgPredicted > 0 ? "What the forecast expected" : "No forecast stored yet"}
            />
            <Stat
              label="Time logged"
              value={hoursFromMinutes(analytics.totalActualMinutes)}
              hint={`of ${hoursFromMinutes(analytics.totalPlannedMinutes)} planned`}
            />
            <Stat label="Focus and completion" value={`${pct(analytics.avgFocus)} · ${pct(analytics.avgCompletion)}`} hint="Average of your own ratings" />
          </section>

          <section className={styles.section} aria-labelledby="by-course">
            <div className={styles.sectionHead}>
              <h2 id="by-course" className={styles.sectionTitle}>
                By course
              </h2>
              <p className={styles.muted}>
                Most logged: {analytics.topCourse} ({analytics.topCourseSessions}) · {analytics.weeklyIntensity.toFixed(1)} sessions a week
              </p>
            </div>
            <ul className={styles.list}>
              {summaries.map((course) => (
                <li key={course.key} className={styles.row} style={colorStyle(course.label)}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>
                      <span className={styles.dot} aria-hidden="true" />
                      {course.label}
                    </p>
                    <p className={styles.rowMeta}>
                      {course.sessions} {course.sessions === 1 ? "session" : "sessions"} · {hoursFromMinutes(course.loggedMinutes)} of{" "}
                      {hoursFromMinutes(course.plannedMinutes)}
                      {course.avgForecast !== null ? ` · forecast ${pct(course.avgForecast)}` : ""}
                    </p>
                    <ProgressBar
                      label={`${course.label} adherence`}
                      value={course.avgAdherence}
                      max={1}
                      valueText={`${pct(course.avgAdherence)} adherence`}
                      hideHeader
                    />
                  </div>
                  <span className={styles.rowNumber}>{pct(course.avgAdherence)}</span>
                </li>
              ))}
            </ul>
            <Link href="/progress/predict" className={styles.link}>
              See next-week forecasts by course
            </Link>
          </section>

          <section className={styles.section} aria-labelledby="recent">
            <div className={styles.sectionHead}>
              <h2 id="recent" className={styles.sectionTitle}>
                Recent sessions
              </h2>
              <Link href="/progress/history" className={styles.link}>
                View all
              </Link>
            </div>
            <ul className={styles.list}>
              {recent.map((item) => (
                <li key={item.id} className={styles.row} style={colorStyle(item.course_name)}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>
                      <span className={styles.dot} aria-hidden="true" />
                      {item.course_name}
                    </p>
                    <p className={styles.rowMeta}>
                      {shortDate(item.created_at)} · {item.actual_minutes} of {item.planned_minutes} min
                      {typeof item.predicted_adherence === "number" ? ` · forecast ${percentText(item.predicted_adherence)}` : ""}
                    </p>
                  </div>
                  <span className={styles.rowNumber}>{percentText(item.adherence_score)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className={styles.section} aria-labelledby="latest-plan">
        <div className={styles.sectionHead}>
          <h2 id="latest-plan" className={styles.sectionTitle}>
            Weekly plan
          </h2>
          <Link href="/planner" className={styles.link}>
            Open the planner
          </Link>
        </div>
        <Suspense fallback={<Skeleton height={64} radius="lg" />}>
          <LatestPlanRow promise={latestPromise} colorStyle={colorStyle} onRetry={() => setLatestPromise(loadLatestPlan())} />
        </Suspense>
      </section>
    </div>
  );
}

function LatestPlanRow({
  promise,
  colorStyle,
  onRetry,
}: {
  promise: Promise<LatestPlan>;
  colorStyle: ReturnType<typeof useSavedCourses>["colorStyle"];
  onRetry: () => void;
}) {
  const result = use(promise);
  if ("error" in result) {
    return (
      <p className={styles.muted}>
        Your plans are unavailable right now.{" "}
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      </p>
    );
  }
  if (!result.plan) return <p className={styles.muted}>No plans yet. Make one in the planner.</p>;
  return (
    <ul className={styles.list}>
      <PlanWeekRow plan={result.plan} colorStyle={colorStyle} />
    </ul>
  );
}
