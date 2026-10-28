"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button, Field, Input, Notice, SegmentedControl, Select } from "@/components/ui";
import { PlanExistsError, savePlan, type Course, type WeeklyPlanDetail } from "@/lib/api";
import type { CourseColor } from "@/lib/course-colors";
import { formatHours, weekStartKey } from "@/lib/week";

import {
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
  /** Called with the saved plan so the flow can refresh its plan list. */
  onSaved: (plan: WeeklyPlanDetail) => void;
  onContinue: () => void;
  /** The current time; tests pass a fixed one. */
  now?: Date;
};

type WeekChoice = "this" | "next";

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 2 Nov" for a YYYY-MM-DD date key. */
function shortDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return `${SHORT_DAYS[(date.getDay() + 6) % 7]} ${day} ${SHORT_MONTHS[month - 1]}`;
}

/**
 * Step 2: weekly hours and each course's difficulty, then the week's first plan. On a Sunday the
 * week is a choice (this week ends today), defaulting to next week. A week that already has a plan
 * (saved from another tab) is left as it is.
 */
export function PlanStep({ courses, colorFor, onSaved, onContinue, now: nowProp }: Props) {
  const id = useId();
  // Fixed for the life of the step, so the week doesn't change under the user at midnight.
  const [now] = useState(() => nowProp ?? new Date());
  const isSunday = now.getDay() === 0;
  const [week, setWeek] = useState<WeekChoice>(isSunday ? "next" : "this");
  const [exists, setExists] = useState(false);
  const [hours, setHours] = useState(DEFAULT_PLAN_HOURS);
  const [rows, setRows] = useState<PlannerRow[]>(() => rowsFromCourses(courses));
  const [problems, setProblems] = useState<PlanProblems>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<WeeklyPlanDetail | null>(null);
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
      const plan = await savePlan(weekStartKey(now, week === "next" ? 1 : 0), {
        courses: rows.map((row) => ({ name: row.name.trim(), difficulty: row.difficulty })),
        total_hours: total,
        base_revision: null,
      });
      setResult(plan);
      onSaved(plan);
    } catch (failure) {
      if (failure instanceof PlanExistsError) setExists(true);
      else setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const planned = result?.plan_json.courses ?? [];
  const plannedTotal = result?.plan_json.total_hours ?? 0;
  const weekLabel = week === "next" ? "next week" : "this week";

  if (exists) {
    return (
      <div className={styles.step}>
        <Notice tone="info" title="You already have this week's plan">
          Another tab saved a plan for {weekLabel}. You can change it any time from the planner.
        </Notice>
        <div className={styles.footer}>
          <span />
          <Button variant="primary" onClick={onContinue}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.step}>
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        {isSunday && !result && (
          <SegmentedControl<WeekChoice>
            label="Which week?"
            value={week}
            onChange={setWeek}
            options={[
              { value: "this", label: "This week (ends today)" },
              { value: "next", label: `Next week (starts ${shortDay(weekStartKey(now, 1))})` },
            ]}
          />
        )}

        <Field label={`Hours you can study ${weekLabel}`} hint={`From ${MIN_HOURS} to ${MAX_HOURS}.`} error={problems.hours} required>
          <Input
            ref={hoursInput}
            type="number"
            inputMode="decimal"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step="any"
            value={hours}
            disabled={result !== null}
            onChange={(event) => setHours(event.target.value)}
          />
        </Field>

        <fieldset className={styles.fieldset} aria-describedby={`${id}-difficulty-hint`} disabled={result !== null}>
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
          <Notice tone="danger" title="Could not save your plan">
            {error}
          </Notice>
        )}

        {!result && (
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={busy}>
              Make my plan
            </Button>
          </div>
        )}
      </form>

      {result && (
        <section aria-labelledby={`${id}-result`} className={styles.step}>
          <h2 id={`${id}-result`} ref={resultHeading} tabIndex={-1} className={styles.sectionTitle}>
            Your plan for {weekLabel}
          </h2>
          <p className={styles.muted}>
            <span className={styles.hoursValue}>{hoursText(plannedTotal)}</span> across {planned.length}{" "}
            {planned.length === 1 ? "course" : "courses"}.
            {result.plan_json.clamped &&
              ` You had already done ${formatHours(result.plan_json.counted_hours)} h, so the total stays there.`}
          </p>
          <ul className={styles.list}>
            {planned.map((entry) => {
              const course = findCourseByName(courses, entry.name);
              return (
                <li key={entry.name} className={styles.row} style={course ? colorFor(course.id).style : undefined}>
                  <span className={styles.dot} aria-hidden="true" />
                  <p className={styles.rowName}>{entry.name}</p>
                  <p className={styles.rowMeta}>{hoursText(entry.planned_hours)}</p>
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
