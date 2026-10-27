"use client";

import { startTransition, Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, CalendarPlus, Square, Timer } from "lucide-react";

import { PageAction, useShellData, WeekMeterSkeleton } from "@/components/app-shell";
import { useActiveTimer, useTimerActions } from "@/components/timer";
import { Button, EmptyState, Notice, ProgressBar, Skeleton, Stat } from "@/components/ui";
import {
  getCourseRecommendations,
  listCourses,
  type Course,
  type CourseRecommendations,
} from "@/lib/api";
import { ONBOARDING_PATH } from "@/lib/onboarding";
import { onSessionsChanged } from "@/lib/timer-refresh";
import { useCourseColors } from "@/lib/use-course-colors";
import { courseHoursThisWeek, formatHours, hasPlanThisWeek, meterText, weekStrip } from "@/lib/week";

import { CourseCard } from "./CourseCard";
import { TopStrategies } from "./TopStrategies";
import { WeekStrip } from "./WeekStrip";
import styles from "./home.module.css";

type HomeData =
  | { courses: Course[]; recommendations: CourseRecommendations[] | null; recommendationsError: string }
  | { error: string };

const NO_COURSES: Course[] = [];

/**
 * Never rejects. Courses are required; recommendations (which also carry each course's
 * forecast) degrade on their own. Plans and sessions come from the shell's data.
 */
function loadHome(): Promise<HomeData> {
  return Promise.allSettled([listCourses(), getCourseRecommendations()]).then(([courses, recs]) => {
    if (courses.status === "rejected") return { error: (courses.reason as Error).message };
    return {
      courses: courses.value,
      recommendations: recs.status === "fulfilled" ? recs.value.courses : null,
      recommendationsError: recs.status === "rejected" ? (recs.reason as Error).message : "",
    };
  });
}

/** "This week": course cards, the week strip and this week's top 3 strategies. */
export default function HomePage() {
  // One request set per page view, refreshed (in a transition, keeping the old view meanwhile)
  // whenever a session is logged anywhere.
  const [promise, setPromise] = useState(loadHome);
  useEffect(() => onSessionsChanged(() => startTransition(() => setPromise(loadHome()))), []);

  return (
    <div className={styles.page}>
      <PageAction>
        <Suspense fallback={<LogLink />}>
          <HomeAction />
        </Suspense>
      </PageAction>

      {/* Phones have no sidebar, so the week meter sits at the top of home. */}
      <section aria-labelledby="week-heading" className={styles.phoneMeter}>
        <h2 id="week-heading" className={styles.srOnly}>
          Hours this week
        </h2>
        <Suspense fallback={<WeekMeterSkeleton />}>
          <WeekSummary />
        </Suspense>
      </section>

      <Suspense fallback={<HomeSkeleton />}>
        <Home promise={promise} onRetry={() => setPromise(loadHome())} />
      </Suspense>
    </div>
  );
}

function LogLink() {
  return (
    <Link href="/progress/log" className={styles.primaryLink}>
      <Timer size={16} aria-hidden="true" />
      Log a session
    </Link>
  );
}

function HomeAction() {
  const timer = useActiveTimer();
  const { openStop } = useTimerActions();
  if (!timer) return <LogLink />;
  return (
    <Button variant="primary" icon={<Square size={14} />} onClick={openStop}>
      Stop timer
    </Button>
  );
}

function WeekSummary() {
  const { week } = useShellData();
  if (!week) {
    return <Stat label="This week" value="—" hint="Hours are unavailable right now." />;
  }
  const hasPlan = week.plannedHours > 0;
  return (
    <div className={styles.summary}>
      <Stat
        label="This week"
        value={formatHours(week.loggedHours)}
        unit={hasPlan ? `of ${formatHours(week.plannedHours)} h` : "h logged"}
        hint={hasPlan ? undefined : "No plan for this week yet."}
      />
      {hasPlan && (
        <ProgressBar
          label="Logged against this week's plan"
          value={week.loggedHours}
          max={week.plannedHours}
          valueText={meterText(week)}
          hideHeader
        />
      )}
    </div>
  );
}

function Home({ promise, onRetry }: { promise: Promise<HomeData>; onRetry: () => void }) {
  const data = use(promise);
  const { plans, sessions } = useShellData();
  const timer = useActiveTimer();
  const { openStart, openStop } = useTimerActions();
  const courses = "courses" in data ? data.courses : NO_COURSES;
  const { colorFor } = useCourseColors(courses);

  if ("error" in data) {
    return (
      <Notice tone="danger" title="Could not load your week">
        <p>{data.error}</p>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </Notice>
    );
  }

  if (courses.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={28} />}
        title="Add your first course"
        description="Your week, forecasts and strategies are built per course."
        action={
          <Link href={ONBOARDING_PATH} className={styles.primaryLink}>
            Set up StudyPilot
          </Link>
        }
      />
    );
  }

  const now = new Date();
  const recsByCourse = new Map((data.recommendations ?? []).map((entry) => [entry.course.id, entry]));
  const planKnown = plans !== null;
  const hasPlan = planKnown && hasPlanThisWeek(plans, now);

  return (
    <>
      {planKnown && !hasPlan && (
        <EmptyState
          className={styles.planPrompt}
          icon={<CalendarPlus size={24} />}
          title="Create this week's plan"
          description="Split your available hours across your courses to set this week's targets."
          action={
            <Link href="/planner" className={styles.primaryLink}>
              Open the planner
            </Link>
          }
        />
      )}

      <section aria-labelledby="courses-heading" className={styles.section}>
        <h2 id="courses-heading" className={styles.sectionTitle}>
          Your courses
        </h2>
        <ul className={styles.cards}>
          {courses.map((course) => {
            const entry = recsByCourse.get(course.id);
            return (
              <CourseCard
                key={course.id}
                course={course}
                color={colorFor(course.id)}
                hours={sessions !== null ? courseHoursThisWeek(course.name, plans ?? [], sessions, now) : null}
                forecast={entry?.evidence.forecast ?? null}
                topRecommendation={entry?.recommendations[0] ?? null}
                timer={timer}
                now={now}
                onStart={() => openStart({ id: course.id, name: course.name, weeklyTargetHours: course.weekly_target_hours })}
                onStop={openStop}
              />
            );
          })}
        </ul>
      </section>

      {sessions !== null && <WeekStrip days={weekStrip(sessions, courses, now)} colorFor={colorFor} />}

      {data.recommendations ? (
        <TopStrategies courses={data.recommendations} colorFor={colorFor} now={now} />
      ) : (
        <Notice tone="warning" title="Strategies are unavailable right now">
          {data.recommendationsError}
        </Notice>
      )}
    </>
  );
}

function HomeSkeleton() {
  return (
    <div className={styles.section} aria-busy="true" aria-label="Loading your week">
      <Skeleton width={160} height={20} />
      <div className={styles.cards}>
        <Skeleton height={180} radius="lg" />
        <Skeleton height={180} radius="lg" />
        <Skeleton height={180} radius="lg" />
      </div>
      <Skeleton height={200} radius="lg" />
    </div>
  );
}
