"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { generatePlan, type Course, type PlanResponse } from "@/lib/api";
import type { CourseColor } from "@/lib/course-colors";

import {
  buildPayload,
  findCourseByName,
  hoursText,
  MAX_HOURS,
  MIN_HOURS,
  rowsFromCourses,
  validatePlanInput,
  type PlanProblems,
  type PlannerRow,
} from "../../(workspace)/planner/plan-model";
import styles from "../onboarding.module.css";

export const DEFAULT_PLAN_HOURS = "10";
const DIFFICULTIES = [1, 2, 3, 4, 5];

type Props = {
  courses: Course[];
  colorFor: (courseId: number) => CourseColor;
  /** Called with each generated plan so the flow can refresh its history. */
  onGenerated: (plan: PlanResponse) => void;
  onContinue: () => void;
};

/** Step 2: weekly hours and each course's difficulty, then the split. */
export function PlanStep({ courses, colorFor, onGenerated, onContinue }: Props) {
  const id = useId();
  const [hours, setHours] = useState(DEFAULT_PLAN_HOURS);
  const [rows, setRows] = useState<PlannerRow[]>(() => rowsFromCourses(courses));
  const [problems, setProblems] = useState<PlanProblems>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlanResponse | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const hoursInput = useRef<HTMLInputElement>(null);

  // A new plan is announced by moving focus to its heading.
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  const setDifficulty = (key: string, difficulty: number) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, difficulty } : row)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const total = hours.trim() === "" ? Number.NaN : Number(hours);
    const found = validatePlanInput(rows, total);
    setProblems(found);
    setError("");
    if (found.hours || found.courses) {
      if (found.hours) hoursInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const plan = await generatePlan(buildPayload(rows, total));
      setResult(plan);
      onGenerated(plan);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const plannedTotal = result ? result.allocations.reduce((sum, item) => sum + item.allocated_hours, 0) : 0;

  return (
    <div className={styles.step}>
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Hours you can study this week" hint={`From ${MIN_HOURS} to ${MAX_HOURS}.`} error={problems.hours} required>
          <Input
            ref={hoursInput}
            type="number"
            inputMode="decimal"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step="any"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
        </Field>

        <fieldset className={styles.fieldset} aria-describedby={`${id}-difficulty-hint`}>
          <legend className={styles.legend}>Difficulty of each course</legend>
          <p id={`${id}-difficulty-hint`} className={styles.muted}>
            1 is easy, 5 is hard. Harder courses get more of your hours.
          </p>
          <ul className={styles.list}>
            {rows.map((row) => {
              const course = courses.find((item) => item.id === row.courseId);
              return (
                <li key={row.key} className={styles.row} style={course ? colorFor(course.id).style : undefined}>
                  <span className={styles.dot} aria-hidden="true" />
                  <p className={styles.rowName}>{row.name}</p>
                  <Select
                    className={styles.rowSelect}
                    aria-label={`Difficulty of ${row.name}`}
                    value={String(row.difficulty)}
                    onChange={(event) => setDifficulty(row.key, Number(event.target.value))}
                  >
                    {DIFFICULTIES.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </Select>
                </li>
              );
            })}
          </ul>
          {problems.courses && (
            <p role="alert" className={styles.muted}>
              {problems.courses}
            </p>
          )}
        </fieldset>

        {error && (
          <Notice tone="danger" title="Could not generate your plan">
            {error}
          </Notice>
        )}

        <div className={styles.actions}>
          <Button type="submit" variant={result ? "secondary" : "primary"} loading={busy}>
            {result ? "Regenerate plan" : "Generate my plan"}
          </Button>
        </div>
      </form>

      {result && (
        <section aria-labelledby={`${id}-result`} className={styles.step}>
          <h2 id={`${id}-result`} ref={resultHeading} tabIndex={-1} className={styles.sectionTitle}>
            Your plan for this week
          </h2>
          <p className={styles.muted}>
            <span className={styles.hoursValue}>{hoursText(plannedTotal)}</span> across {result.allocations.length}{" "}
            {result.allocations.length === 1 ? "course" : "courses"}.
          </p>
          <ul className={styles.list}>
            {result.allocations.map((allocation) => {
              const course = findCourseByName(courses, allocation.course);
              return (
                <li key={allocation.course} className={styles.row} style={course ? colorFor(course.id).style : undefined}>
                  <span className={styles.dot} aria-hidden="true" />
                  <p className={styles.rowName}>{allocation.course}</p>
                  <p className={styles.rowMeta}>{hoursText(allocation.allocated_hours)}</p>
                </li>
              );
            })}
          </ul>
          <div className={styles.footer}>
            <p className={styles.muted}>You can change the plan any time from the planner.</p>
            <Button variant="primary" onClick={onContinue}>
              Continue
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
