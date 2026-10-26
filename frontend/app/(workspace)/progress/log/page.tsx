"use client";

import { Suspense, use, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen, Play, Square } from "lucide-react";

import { useShellData } from "@/components/app-shell";
import {
  CompletionScale,
  DEFAULT_COMPLETION,
  DEFAULT_FOCUS,
  ElapsedTime,
  FocusScale,
  useActiveTimer,
  useTimerActions,
} from "@/components/timer";
import { Button, Card, EmptyState, Field, Input, Notice, Select, Skeleton } from "@/components/ui";
import { listCourses, type Course } from "@/lib/api";
import { defaultPlannedMinutes, MAX_ACTUAL_MINUTES, PLANNED_MAX, PLANNED_MIN } from "@/lib/timer";
import { logStudySession } from "@/lib/timer-refresh";

import { useProgress } from "../_lib/shared";
import styles from "./log.module.css";

type Loaded = { courses: Course[] } | { error: string };

/** Never rejects; a failure renders as a Notice with a retry. */
function loadCourses(): Promise<Loaded> {
  return listCourses().then(
    (courses) => ({ courses }),
    (error: Error) => ({ error: error.message }),
  );
}

export default function ProgressLogPage() {
  // Fetched once per page view (a lazy initialiser read with use(), not an effect).
  const [promise, setPromise] = useState(loadCourses);
  return (
    <Suspense fallback={<LogSkeleton />}>
      <LogSession promise={promise} onRetry={() => setPromise(loadCourses())} />
    </Suspense>
  );
}

function LogSession({ promise, onRetry }: { promise: Promise<Loaded>; onRetry: () => void }) {
  const loaded = use(promise);
  if ("error" in loaded) {
    return (
      <Notice tone="danger" title="Could not load your courses">
        <p>{loaded.error}</p>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </Notice>
    );
  }
  if (loaded.courses.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={28} />}
        title="Add a course first"
        description="Sessions are logged against one of your courses."
        action={
          <Link href="/courses" className={styles.link}>
            Go to courses
          </Link>
        }
      />
    );
  }
  return <LogForm courses={loaded.courses} />;
}

function LogForm({ courses }: { courses: Course[] }) {
  const { plans, sessions } = useShellData();
  const { refresh } = useProgress();
  const { openStart, openStop } = useTimerActions();
  const timer = useActiveTimer();
  const formId = useId();

  const suggest = (course: Course) =>
    String(
      defaultPlannedMinutes({
        courseName: course.name,
        weeklyTargetHours: course.weekly_target_hours,
        plans: plans ?? [],
        sessions: sessions ?? [],
        now: new Date(),
      }),
    );

  const [courseId, setCourseId] = useState(courses[0].id);
  const course = courses.find((item) => item.id === courseId) ?? courses[0];
  const [planned, setPlanned] = useState(() => suggest(courses[0]));
  const [actual, setActual] = useState(() => suggest(courses[0]));
  const [focus, setFocus] = useState(DEFAULT_FOCUS);
  const [completion, setCompletion] = useState(DEFAULT_COMPLETION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const plannedValue = Number(planned);
  const actualValue = Number(actual);
  const plannedInvalid = !Number.isInteger(plannedValue) || planned.trim() === "" || plannedValue < PLANNED_MIN || plannedValue > PLANNED_MAX;
  // 0 is allowed for a past session: a planned session that didn't happen still counts.
  const actualInvalid = !Number.isInteger(actualValue) || actual.trim() === "" || actualValue < 0 || actualValue > MAX_ACTUAL_MINUTES;

  const chooseCourse = (id: number) => {
    const next = courses.find((item) => item.id === id) ?? courses[0];
    setCourseId(next.id);
    setPlanned(suggest(next));
    setActual(suggest(next));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (plannedInvalid || actualInvalid || saving) return;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const response = await logStudySession({
        course_name: course.name,
        planned_minutes: plannedValue,
        actual_minutes: actualValue,
        focus_score: Number(focus),
        completion_rate: Number(completion),
      });
      setSaved(
        `Logged ${actualValue} min of ${course.name}. Adherence ${Math.round(response.computed.adherence * 100)}% of the planned time.`,
      );
      // The progress tabs share their own copy of the history; bring it up to date too.
      void refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <Field label="Course" hint="Used by both the timer and the form below.">
        <Select value={String(course.id)} onChange={(event) => chooseCourse(Number(event.target.value))}>
          {courses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>

      <Card as="section" aria-labelledby={`${formId}-timer`}>
        <div className={styles.timerRow}>
          <div>
            <h2 id={`${formId}-timer`} className={styles.heading}>
              Study now
            </h2>
            <p className={styles.muted}>Start a timer and log the session when you stop it.</p>
          </div>
          {timer ? (
            <Button icon={<Square size={14} />} onClick={openStop}>
              Stop {timer.courseName} <ElapsedTime timer={timer} />
            </Button>
          ) : (
            <Button
              icon={<Play size={16} />}
              onClick={() => openStart({ id: course.id, name: course.name, weeklyTargetHours: course.weekly_target_hours })}
            >
              Start timer for {course.name}
            </Button>
          )}
        </div>
      </Card>

      <Card as="section" aria-labelledby={`${formId}-past`}>
        <h2 id={`${formId}-past`} className={styles.heading}>
          Log a past session
        </h2>
        <p className={styles.muted}>For a session of {course.name} you didn&rsquo;t time here.</p>
        <form id={formId} className={styles.form} onSubmit={onSubmit}>
          <div className={styles.pair}>
            <Field label="Planned minutes" error={plannedInvalid ? `Enter ${PLANNED_MIN} to ${PLANNED_MAX}.` : undefined}>
              <Input type="number" inputMode="numeric" min={PLANNED_MIN} max={PLANNED_MAX} value={planned} onChange={(event) => setPlanned(event.target.value)} />
            </Field>
            <Field
              label="Actual minutes"
              hint="0 if the session didn't happen."
              error={actualInvalid ? `Enter 0 to ${MAX_ACTUAL_MINUTES}.` : undefined}
            >
              <Input type="number" inputMode="numeric" min={0} max={MAX_ACTUAL_MINUTES} value={actual} onChange={(event) => setActual(event.target.value)} />
            </Field>
          </div>
          <FocusScale value={focus} onChange={setFocus} />
          <CompletionScale value={completion} onChange={setCompletion} />
          {error && (
            <Notice tone="danger" title="Couldn't log the session">
              {error}
            </Notice>
          )}
          {saved && <Notice tone="success">{saved}</Notice>}
          <div>
            <Button variant="primary" type="submit" loading={saving} disabled={plannedInvalid || actualInvalid}>
              Log session
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function LogSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading">
      <Skeleton height={88} radius="lg" />
      <Skeleton height={360} radius="lg" />
    </div>
  );
}
