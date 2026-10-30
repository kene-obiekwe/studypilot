"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { CalendarRange, Plus, X } from "lucide-react";

import { PageAction } from "@/components/app-shell";
import { Button, Disclosure, Field, IconButton, Input, Notice, Select } from "@/components/ui";
import {
  getPlan,
  PlanChangedError,
  PlanExistsError,
  previewPlan,
  savePlan,
  type Course,
  type PlanPreview,
  type SessionHistoryItem,
  type WeeklyPlan,
  type WeeklyPlanDetail,
  type WeeklyPlanInput,
} from "@/lib/api";
import { courseKey } from "@/lib/courses";
import { daysLeft, formatHours } from "@/lib/week";

import {
  buildInput,
  chosenTotal,
  daysLeftText,
  DEFAULT_TOTAL_HOURS,
  defaultMoreHours,
  hoursInput,
  loggedOnRows,
  MAX_HOURS,
  MIN_HOURS,
  newRow,
  rebaseInput,
  rowsFromCourses,
  rowsFromPlan,
  validatePlanInput,
  type PlanDraft,
  type PlannerRow,
  type PlanProblems,
  type WeekTarget,
} from "./plan-model";
import { PlanPreviewTable } from "./PlanPreviewTable";
import styles from "./planner.module.css";

const FORM_ID = "plan-form";
const DIFFICULTY_LABELS = ["1 · Easy", "2", "3 · Medium", "4", "5 · Hard"];
const CONFLICT_MESSAGE = "This plan changed in another tab. Review the new split before saving.";

type PlanEditorProps = {
  target: WeekTarget;
  weekStart: string;
  /** The week's current plan (an update), or null (a first plan). */
  plan: WeeklyPlan | WeeklyPlanDetail | null;
  courses: Course[];
  sessions: SessionHistoryItem[];
  now: Date;
  /** The zone that decides the week; the browser's when omitted. */
  zone?: string;
  /** Pre-fills a first plan; nothing is saved until the preview is confirmed. */
  draft: PlanDraft | null;
  colorStyle: (courseName: string) => CSSProperties | undefined;
  onSaved: (plan: WeeklyPlanDetail) => void;
  /** Reloads the page's data in the background (after a conflict, so the cards catch up). */
  onRefresh: () => void;
  onCancel?: () => void;
};

/**
 * The plan form and its preview. A first plan asks for the week's total; an update asks how many
 * more hours. Submitting previews the split (nothing saved); "Save this plan" saves it against the
 * revision it was opened at, and a 409 refetches the plan and previews again.
 */
export function PlanEditor({
  target,
  weekStart,
  plan,
  courses,
  sessions,
  now,
  zone,
  draft,
  colorStyle,
  onSaved,
  onRefresh,
  onCancel,
}: PlanEditorProps) {
  const [rows, setRows] = useState<PlannerRow[]>(() => draft?.rows ?? (plan ? rowsFromPlan(plan, courses) : rowsFromCourses(courses)));
  // The revision this form updates (null: a first plan). It moves only when a conflict is resolved.
  const [baseRevision, setBaseRevision] = useState<number | null>(plan?.revision ?? null);
  const [chosen, setChosen] = useState(() => (plan ? chosenTotal(plan) : 0));
  // null until the user types: an update's "more" then follows the rows (chosen total less done).
  const [hours, setHours] = useState<string | null>(plan ? null : hoursInput(draft?.totalHours ?? DEFAULT_TOTAL_HOURS));
  const [problems, setProblems] = useState<PlanProblems>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ result: PlanPreview; input: WeeklyPlanInput; base: WeeklyPlan | null } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [basePlan, setBasePlan] = useState<WeeklyPlan | null>(plan);
  const nextKey = useRef(0);
  // Where focus goes after the next render: a new row's name, the first problem, the preview or the hours.
  const focusTarget = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selector = focusTarget.current;
    if (selector) {
      focusTarget.current = null;
      rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
    }
  });

  const mode = baseRevision === null ? "first" : "update";
  const next = target === "next";
  const counted = next ? 0 : loggedOnRows(rows, sessions, now, zone);
  const hoursValue = hours ?? hoursInput(defaultMoreHours(chosen, counted));
  const days = daysLeft(now, zone);

  const updateRow = (key: string, patch: Partial<PlannerRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => {
    const key = `new-${++nextKey.current}`;
    focusTarget.current = `[data-row="${key}"] input`;
    setRows((current) => [...current, newRow(key)]);
  };

  const showPreview = (result: PlanPreview, input: WeeklyPlanInput, base: WeeklyPlan | null, changed: boolean) => {
    setPreview({ result, input, base });
    setConflict(changed);
    focusTarget.current = "[data-preview]";
  };

  /** Someone saved this week's plan elsewhere: fetch it, and preview the same request against it. */
  const recover = async (input: WeeklyPlanInput) => {
    const fresh = await getPlan(weekStart, { revisions: true });
    onRefresh();
    const revision = fresh?.revision ?? null;
    const rebased = rebaseInput(input, revision, counted);
    setBaseRevision(revision);
    setBasePlan(fresh);
    if (fresh) setChosen(chosenTotal(fresh));
    setHours(hoursInput("total_hours" in rebased ? rebased.total_hours : rebased.more_hours));
    const result = await previewPlan(weekStart, rebased);
    showPreview(result, rebased, fresh, true);
  };

  const isConflict = (failure: unknown) => failure instanceof PlanChangedError || failure instanceof PlanExistsError;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || preview) return;
    const value = Number(hoursValue);
    const found = validatePlanInput(rows, value, mode === "first" ? "total" : "more", counted);
    setProblems(found);
    setError("");
    if (found.hours || found.courses) {
      focusTarget.current = "[aria-invalid='true'], [data-problem]";
      return;
    }
    const input = buildInput(rows, value, baseRevision);
    setBusy(true);
    try {
      try {
        showPreview(await previewPlan(weekStart, input), input, basePlan, false);
      } catch (failure) {
        if (!isConflict(failure)) throw failure;
        await recover(input);
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      try {
        const saved = await savePlan(weekStart, preview.input);
        onSaved(saved);
        // Stays busy: the page reloads and closes this form.
        return;
      } catch (failure) {
        if (!isConflict(failure)) throw failure;
        await recover(preview.input);
      }
    } catch (failure) {
      setError((failure as Error).message);
    }
    setBusy(false);
  };

  const backToEditing = () => {
    setPreview(null);
    setConflict(false);
    setError("");
    focusTarget.current = "input[name='hours']";
  };

  const weekWord = next ? "next week" : "this week";
  const title =
    mode === "update"
      ? `Update ${next ? "next" : "this"} week's plan`
      : next
        ? "Plan next week"
        : "No plan for this week yet.";
  const hoursLabel =
    mode === "first" || next ? `How many hours can you study ${weekWord}?` : "How many more hours can you study this week?";
  const hoursHint =
    mode === "first"
      ? `From ${MIN_HOURS} to ${MAX_HOURS}.${counted > 0 ? ` Already done this week: ${formatHours(counted)} h on these courses; it counts towards the total.` : ""}`
      : next
        ? "Nothing is logged next week yet, so this is the week's total."
        : `Already done this week: ${formatHours(counted)} h on courses in the plan.`;
  const submitLabel = mode === "update" ? "Preview changes" : next ? "Plan next week" : "Plan this week";

  return (
    <div ref={rootRef} className={styles.section}>
      {!preview && (
        <PageAction>
          <Button type="submit" form={FORM_ID} variant="primary" icon={<CalendarRange size={16} />} loading={busy}>
            {submitLabel}
          </Button>
        </PageAction>
      )}

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {onCancel && !preview && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {mode === "first" && <p className={styles.muted}>Split your available hours across your courses.</p>}
      {draft && mode === "first" && (
        <Notice tone="info">Filled in from {next ? "this" : "last"} week&apos;s plan. Nothing is saved until you check the preview and save it.</Notice>
      )}

      <form id={FORM_ID} onSubmit={(event) => void onSubmit(event)} noValidate>
        <fieldset className={styles.fieldset} disabled={preview !== null || busy}>
          <legend className={styles.srOnly}>{title}</legend>
          <div className={styles.hoursLine}>
            <Field label={hoursLabel} hint={hoursHint} error={problems.hours} className={styles.hoursField} required>
              <Input
                name="hours"
                type="number"
                inputMode="decimal"
                min={mode === "first" ? MIN_HOURS : 0}
                max={MAX_HOURS}
                step={0.5}
                value={hoursValue}
                onChange={(event) => setHours(event.target.value)}
              />
            </Field>
            {mode === "update" && !next && <p className={styles.daysLeft}>{daysLeftText(days)}</p>}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.subTitle}>Courses in this plan</h3>
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
              {courses.some((course) => !rows.some((row) => courseKey(row.name) === courseKey(course.name))) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const present = new Set(rows.map((row) => courseKey(row.name)));
                    setRows((current) => [...current, ...rowsFromCourses(courses.filter((course) => !present.has(courseKey(course.name))))]);
                  }}
                >
                  Add back my saved courses
                </Button>
              )}
              <p className={styles.muted}>A new name becomes a saved course when you save the plan.</p>
            </div>
          </div>
        </fieldset>
      </form>

      {error && (
        <Notice tone="danger" title={preview ? "Could not save the plan" : "Could not work out the plan"}>
          {error}
        </Notice>
      )}

      {preview && (
        <section className={styles.preview} aria-labelledby="plan-preview-title" data-preview="" tabIndex={-1}>
          {conflict && <Notice tone="warning">{CONFLICT_MESSAGE}</Notice>}
          <div className={styles.sectionHead}>
            <h2 id="plan-preview-title" className={styles.sectionTitle}>
              Check the new split
            </h2>
            <p className={styles.muted}>Nothing is saved yet.</p>
          </div>
          <PlanPreviewTable preview={preview.result} base={preview.base} colorStyle={colorStyle} />
          <div className={styles.addRow}>
            <Button variant="primary" loading={busy} onClick={() => void onSave()}>
              Save this plan
            </Button>
            <Button onClick={backToEditing} disabled={busy}>
              Back to editing
            </Button>
          </div>
        </section>
      )}

      <Disclosure summary="How is this worked out?">
        <div className={styles.explain}>
          <p>
            Each course gets a fair share of the week, split by difficulty: a course rated 5 gets more than one rated 2. The
            share is nudged by how you have been doing: a forecast if there is one, otherwise your adherence over the last 30
            days (under 50% gives 0.8 times the weight, under 70% 0.9 times, under 85% no change, 85% or more 1.1 times).
          </p>
          <p>
            Hours you have already logged this week count towards each course&apos;s share, so a course you are ahead on
            gets fewer new hours, and one already past its share gets none. The new hours always add up to what you entered.
          </p>
          <p>
            Hours logged on a course that isn&apos;t in the plan stay in your history but don&apos;t count towards the week.
            Sessions belong to a course by its name.
          </p>
        </div>
      </Disclosure>
    </div>
  );
}
