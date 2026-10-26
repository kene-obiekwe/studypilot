"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarRange, Plus, X } from "lucide-react";

import { PageAction } from "@/components/app-shell";
import { Button, Disclosure, EmptyState, Field, IconButton, Input, Notice, Select, Skeleton } from "@/components/ui";
import { generatePlan, listCourses, type Course, type PlanResponse } from "@/lib/api";
import { courseKey } from "@/lib/courses";
import { useCourseColors } from "@/lib/use-course-colors";

import { PlanResults } from "./PlanResults";
import {
  buildPayload,
  hoursText,
  MAX_HOURS,
  MIN_HOURS,
  newRow,
  rowsFromCourses,
  validatePlanInput,
  type PlanAllocation,
  type PlanProblems,
  type PlannerRow,
} from "./plan-model";
import styles from "./planner.module.css";

const DEFAULT_HOURS = 12;
const FORM_ID = "plan-form";

const DIFFICULTY_LABELS = ["1 · Easy", "2", "3 · Medium", "4", "5 · Hard"];

export default function PlannerPage() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState<PlannerRow[]>([]);
  const [hours, setHours] = useState(String(DEFAULT_HOURS));
  const [problems, setProblems] = useState<PlanProblems>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [resultHours, setResultHours] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [resultVersion, setResultVersion] = useState(0);
  const nextKey = useRef(0);
  const focusKey = useRef<string | null>(null);
  const hoursId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const { colorFor } = useCourseColors(courses ?? []);
  const idsByName = useMemo(() => new Map((courses ?? []).map((course) => [courseKey(course.name), course.id])), [courses]);
  const colorStyle = (name: string) => {
    const id = idsByName.get(courseKey(name));
    return id === undefined ? undefined : colorFor(id).style;
  };

  const load = async () => {
    try {
      const saved = await listCourses();
      setCourses(saved);
      setRows(rowsFromCourses(saved));
      setLoadError("");
    } catch (failure) {
      setLoadError((failure as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // After adding a row, move focus to its name field.
  useEffect(() => {
    const target = focusKey.current;
    if (target) {
      focusKey.current = null;
      formRef.current?.querySelector<HTMLElement>(`[data-row="${target}"] input`)?.focus();
    }
  });

  // After a failed check, move focus to the first problem; after a new plan, to the result.
  useEffect(() => {
    if (attempt > 0) {
      formRef.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-problem]")?.focus();
    }
  }, [attempt]);

  useEffect(() => {
    if (resultVersion > 0) {
      resultRef.current?.focus();
    }
  }, [resultVersion]);

  const updateRow = (key: string, patch: Partial<PlannerRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => {
    const key = `new-${++nextKey.current}`;
    focusKey.current = key;
    setRows((current) => [...current, newRow(key)]);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const total = Number(hours);
    const found = validatePlanInput(rows, total);
    setProblems(found);
    setError("");
    if (found.hours || found.courses) {
      setAttempt((count) => count + 1);
      return;
    }
    setBusy(true);
    try {
      const response = await generatePlan(buildPayload(rows, total));
      setResult(response);
      setResultHours(total);
      // New names became saved courses, so reload them for colours and to keep the rows in step.
      const saved = await listCourses();
      setCourses(saved);
      setResultVersion((count) => count + 1);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const allocations = (result?.allocations ?? []) as PlanAllocation[];
  const noCourses = courses !== null && courses.length === 0;

  return (
    <div className={styles.page}>
      {!noCourses && courses !== null && (
        <PageAction>
          <Button type="submit" form={FORM_ID} variant="primary" icon={<CalendarRange size={16} />} loading={busy}>
            Generate plan
          </Button>
        </PageAction>
      )}

      {loadError && (
        <Notice tone="danger" title="Could not load your courses">
          {loadError}{" "}
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Try again
          </Button>
        </Notice>
      )}

      {courses === null && !loadError && (
        <div className={styles.section} aria-busy="true" aria-label="Loading your courses">
          <Skeleton height={44} />
          <Skeleton height={160} />
        </div>
      )}

      {noCourses && (
        <EmptyState
          icon={<CalendarRange size={28} />}
          title="Add your courses first"
          description="A plan splits your weekly hours across the courses you study."
          action={
            <Link href="/courses" className={styles.linkButton}>
              Go to courses
            </Link>
          }
        />
      )}

      {courses !== null && courses.length > 0 && (
        <form id={FORM_ID} ref={formRef} className={styles.section} onSubmit={(event) => void onSubmit(event)} noValidate>
          <Field
            label="Hours you can study this week"
            hint={`From ${MIN_HOURS} to ${MAX_HOURS}.`}
            error={problems.hours}
            className={styles.hoursField}
            required
          >
            <Input
              id={hoursId}
              name="total_available_hours"
              type="number"
              inputMode="decimal"
              min={MIN_HOURS}
              max={MAX_HOURS}
              step={0.5}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </Field>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Courses in this plan</h2>
              <p className={styles.muted}>Removing a course here only leaves it out of this plan.</p>
            </div>

            {rows.length > 0 && (
              <ul className={styles.rows}>
                {rows.map((row) => {
                  const label = row.name.trim() || "new course";
                  return (
                    <li key={row.key} className={styles.row} data-row={row.key}>
                      <span className={styles.dot} style={row.name ? colorStyle(row.name) : undefined} aria-hidden="true" />
                      {row.courseId !== null ? (
                        <p className={styles.name}>{row.name}</p>
                      ) : (
                        <Input
                          aria-label="Course name"
                          value={row.name}
                          maxLength={120}
                          placeholder="Course name"
                          autoComplete="off"
                          onChange={(event) => updateRow(row.key, { name: event.target.value })}
                        />
                      )}
                      <Select
                        className={styles.difficulty}
                        aria-label={`Difficulty of ${label}`}
                        value={String(row.difficulty)}
                        onChange={(event) => updateRow(row.key, { difficulty: Number(event.target.value) })}
                      >
                        {DIFFICULTY_LABELS.map((text, index) => (
                          <option key={text} value={index + 1}>
                            {text}
                          </option>
                        ))}
                      </Select>
                      <IconButton
                        aria-label={`Remove ${label} from this plan`}
                        icon={<X size={16} />}
                        size="sm"
                        onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            {problems.courses && (
              <p className={styles.error} role="alert" tabIndex={-1} data-problem="">
                {problems.courses}
              </p>
            )}

            <div className={styles.addRow}>
              <Button icon={<Plus size={16} />} onClick={addRow}>
                Add a course
              </Button>
              {rows.length < (courses?.length ?? 0) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const present = new Set(rows.map((row) => courseKey(row.name)));
                    setRows((current) => [...current, ...rowsFromCourses((courses ?? []).filter((course) => !present.has(courseKey(course.name))))]);
                  }}
                >
                  Add back my saved courses
                </Button>
              )}
              <p className={styles.muted}>A new name becomes a saved course when you generate the plan.</p>
            </div>
          </div>

          {error && (
            <Notice tone="danger" title="Could not generate the plan">
              {error}
            </Notice>
          )}

          <Disclosure summary="How is this worked out?">
            <div className={styles.explain}>
              <p>Your hours are first split by difficulty: a course rated 5 gets more than one rated 2.</p>
              <p>
                Then each course is nudged by how you have been doing. If a forecast is available, it sets the
                nudge; otherwise the planner uses your adherence over the last 30 days. Under 50% adherence cuts
                a course&apos;s hours to 0.8 times, under 70% to 0.9 times, under 85% leaves them as they are, and
                85% or more raises them to 1.1 times.
              </p>
              <p>Finally the hours are scaled so the total is exactly what you entered. Only the split changes.</p>
            </div>
          </Disclosure>
        </form>
      )}

      {result && (
        <section className={styles.section} aria-labelledby="plan-result-title">
          <div className={styles.sectionHead}>
            <h2 id="plan-result-title" className={styles.sectionTitle}>
              Your plan
            </h2>
            <p className={styles.muted}>
              {hoursText(resultHours)} across {allocations.length} {allocations.length === 1 ? "course" : "courses"}
            </p>
          </div>
          <div ref={resultRef} tabIndex={-1} className={styles.section}>
            <Notice tone="success">
              Plan saved. See it any time in <Link href="/progress/history">Progress history</Link>.
            </Notice>
            <PlanResults allocations={allocations} colorStyle={colorStyle} />
          </div>
        </section>
      )}
    </div>
  );
}
