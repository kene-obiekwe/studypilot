"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

import { CompletionScale, DEFAULT_COMPLETION, DEFAULT_FOCUS, FocusScale } from "@/components/timer";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import type { Course, Me, SessionHistoryItem } from "@/lib/api";
import { markOnboardingDone } from "@/lib/onboarding";
import {
  clampPlanned,
  defaultPlannedMinutes,
  MAX_ACTUAL_MINUTES,
  PLANNED_MAX,
  PLANNED_MIN,
  timerForUser,
} from "@/lib/timer";
import { logStudySession } from "@/lib/timer-refresh";
import { startTimer, useStoredTimer } from "@/lib/timer-store";
import type { PlanLike } from "@/lib/week";

import styles from "../onboarding.module.css";

type Props = {
  me: Me | null;
  courses: Course[];
  plans: readonly PlanLike[];
  sessions: SessionHistoryItem[];
};

/** Step 3: time a session now, or log one that already happened. Either way the user ends up on /home. */
export function SessionStep({ me, courses, plans, sessions }: Props) {
  const router = useRouter();
  const formId = useId();
  const runningTimer = timerForUser(useStoredTimer(), me?.id ?? null);

  const suggest = (course: Course) =>
    defaultPlannedMinutes({
      courseName: course.name,
      weeklyTargetHours: course.weekly_target_hours,
      plans,
      sessions,
      now: new Date(),
    });

  const [courseId, setCourseId] = useState(courses[0].id);
  const course = courses.find((item) => item.id === courseId) ?? courses[0];
  const [logging, setLogging] = useState(false);
  const [planned, setPlanned] = useState(() => String(suggest(courses[0])));
  const [actual, setActual] = useState(() => String(suggest(courses[0])));
  const [focus, setFocus] = useState(DEFAULT_FOCUS);
  const [completion, setCompletion] = useState(DEFAULT_COMPLETION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const plannedValue = Number(planned);
  const actualValue = Number(actual);
  const plannedInvalid = planned.trim() === "" || !Number.isInteger(plannedValue) || plannedValue < PLANNED_MIN || plannedValue > PLANNED_MAX;
  // 0 is allowed for a past session: a planned session that didn't happen still counts.
  const actualInvalid = actual.trim() === "" || !Number.isInteger(actualValue) || actualValue < 0 || actualValue > MAX_ACTUAL_MINUTES;

  const chooseCourse = (id: number) => {
    const next = courses.find((item) => item.id === id) ?? courses[0];
    setCourseId(next.id);
    setPlanned(String(suggest(next)));
    setActual(String(suggest(next)));
  };

  const finish = () => markOnboardingDone(me?.id ?? null);

  const startNow = () => {
    startTimer({
      userId: me?.id ?? null,
      courseId: course.id,
      courseName: course.name,
      startedAt: Date.now(),
      plannedMinutes: clampPlanned(suggest(course)),
    });
    finish();
    router.push("/home");
  };

  const submitLog = async (event: FormEvent) => {
    event.preventDefault();
    if (plannedInvalid || actualInvalid || saving) return;
    setSaving(true);
    setError("");
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
      setLogging(false);
      finish();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className={styles.step}>
        <Notice tone="success" title="Session logged">
          {saved}
        </Notice>
        <div className={styles.actions}>
          <Link href="/home" className={styles.primaryLink}>
            Go to your week
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.step}>
      <Field label="Course">
        <Select value={String(course.id)} onChange={(event) => chooseCourse(Number(event.target.value))}>
          {courses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>

      {runningTimer && (
        <Notice tone="info" title={`A timer is already running for ${runningTimer.courseName}`}>
          Stop it from your week to log that session.{" "}
          <Link href="/home" onClick={finish}>
            Go to your week
          </Link>
        </Notice>
      )}

      <div className={styles.actions}>
        <Button variant="primary" icon={<Play size={16} />} disabled={runningTimer !== null} onClick={startNow}>
          Start a timer now
        </Button>
        <Button aria-expanded={logging} aria-controls={formId} onClick={() => setLogging((open) => !open)}>
          Log a past session
        </Button>
      </div>

      {logging && (
        <form id={formId} className={styles.form} onSubmit={(event) => void submitLog(event)} noValidate>
          <div className={styles.pair}>
            <Field label="Planned minutes" error={plannedInvalid ? `Enter ${PLANNED_MIN} to ${PLANNED_MAX}.` : undefined}>
              <Input
                type="number"
                inputMode="numeric"
                min={PLANNED_MIN}
                max={PLANNED_MAX}
                value={planned}
                onChange={(event) => setPlanned(event.target.value)}
              />
            </Field>
            <Field
              label="Actual minutes"
              hint="0 if the session didn't happen."
              error={actualInvalid ? `Enter 0 to ${MAX_ACTUAL_MINUTES}.` : undefined}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_ACTUAL_MINUTES}
                value={actual}
                onChange={(event) => setActual(event.target.value)}
              />
            </Field>
          </div>
          <FocusScale value={focus} onChange={setFocus} />
          <CompletionScale value={completion} onChange={setCompletion} />
          {error && (
            <Notice tone="danger" title="Could not log the session">
              {error}
            </Notice>
          )}
          <div className={styles.actions}>
            <Button type="submit" loading={saving} disabled={plannedInvalid || actualInvalid}>
              Log session
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
