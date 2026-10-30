"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button, Checkbox, Field, Input, Notice, SegmentedControl, Select } from "@/components/ui";
import {
  ApiError,
  suggestCourseTraits,
  type AssessmentFormat,
  type Course,
  type CourseInput,
  type LearningDemand,
  type TraitSuggestion,
} from "@/lib/api";

import {
  applySuggestion,
  DEMAND_OPTIONS,
  emptyForm,
  FORMAT_OPTIONS,
  formFromCourse,
  formToInput,
  initialTouched,
  MAX_DEMANDS,
  MAX_NAME_LENGTH,
  toggleDemand,
  validateForm,
  type BuildsOnEarlier,
  type CourseFormState,
  type FormErrors,
  type TouchableField,
} from "./course-form";
import styles from "./courses.module.css";

export const SUGGESTED_NOTE = "Suggested from the course name, check and adjust.";
export const DEMAND_CAP_HINT = `You can pick up to ${MAX_DEMANDS}. Untick one to choose another.`;

const DIFFICULTY_OPTIONS = ["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }));
const BUILDS_ON_OPTIONS: Array<{ value: BuildsOnEarlier; label: string }> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

type ServerErrors = Partial<Record<"name" | "difficulty" | "demands" | "buildsOn" | "format" | "examDate", string>>;

const SERVER_FIELDS: Record<string, keyof ServerErrors> = {
  name: "name",
  difficulty: "difficulty",
  learning_demands: "demands",
  builds_on_earlier: "buildsOn",
  assessment_format: "format",
  exam_date: "examDate",
};

export type CourseFormProps = {
  /** The id of the <form>, so a button outside it (the dialog footer) can submit it. */
  formId: string;
  /** The course being edited; omit to add a new one. */
  course?: Course;
  /** Saves the course. Reject with an ApiError to show its messages on the matching fields. */
  onSubmit: (input: CourseInput) => Promise<void>;
  /** Looks up traits for a name. Defaults to the API; tests pass a stub. */
  suggest?: (name: string) => Promise<TraitSuggestion>;
};

/** The add and edit form. It never saves a suggestion: the user reviews it and presses Save. */
export function CourseForm({ formId, course, onSubmit, suggest = suggestCourseTraits }: CourseFormProps) {
  const [form, setForm] = useState<CourseFormState>(() => (course ? formFromCourse(course) : emptyForm()));
  const formRef = useRef(form);
  const [touched] = useState<Set<TouchableField>>(() => initialTouched(course));
  const lastSuggestedName = useRef(course?.name.trim() ?? "");
  const suggestionRequest = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const formElement = useRef<HTMLFormElement>(null);

  const [errors, setErrors] = useState<FormErrors & ServerErrors>({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [capHint, setCapHint] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const demandsLegend = useId();

  // Start in the name field. Waits a tick: the dialog opens (and picks its own first focus) after mount.
  useEffect(() => {
    const timer = window.setTimeout(() => nameInput.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // After a failed submit, focus the first invalid field, or the error notice.
  useEffect(() => {
    if (attempt === 0) return;
    const root = formElement.current;
    (root?.querySelector<HTMLElement>("[aria-invalid='true']") ?? root?.querySelector<HTMLElement>("[data-form-message]"))?.focus();
  }, [attempt]);

  const commit = (next: CourseFormState) => {
    formRef.current = next;
    setForm(next);
  };

  const change = (patch: Partial<CourseFormState>, field?: TouchableField) => {
    if (field) touched.add(field);
    commit({ ...formRef.current, ...patch });
  };

  const requestSuggestion = (name: string) => {
    const request = ++suggestionRequest.current;
    lastSuggestedName.current = name;
    setSuggesting(true);
    suggest(name)
      .then((suggestion) => {
        if (request !== suggestionRequest.current) return; // a newer lookup superseded this one
        const result = applySuggestion(formRef.current, touched, suggestion);
        if (result.applied) {
          commit(result.state);
          setSuggested(true);
        }
      })
      .catch(() => {
        // Suggestions are a convenience: if the lookup fails the user just fills the fields in.
      })
      .finally(() => {
        if (request === suggestionRequest.current) setSuggesting(false);
      });
  };

  const onNameBlur = () => {
    const name = formRef.current.name.trim();
    if (name && name !== lastSuggestedName.current) {
      requestSuggestion(name);
    }
  };

  const onDemandChange = (demand: LearningDemand) => {
    const result = toggleDemand(formRef.current.learningDemands, demand);
    setCapHint(result.blocked);
    if (!result.blocked) {
      change({ learningDemands: result.demands }, "learningDemands");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const problems = validateForm(formRef.current);
    setMessage("");
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setAttempt((count) => count + 1);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit(formToInput(formRef.current));
    } catch (error) {
      const server: ServerErrors = {};
      if (error instanceof ApiError) {
        for (const [apiField, uiField] of Object.entries(SERVER_FIELDS)) {
          const first = error.fieldErrors[apiField]?.[0];
          if (first) server[uiField] = first;
        }
      }
      setErrors(server);
      setMessage(Object.keys(server).length === 0 ? (error as Error).message : "");
      setAttempt((count) => count + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form id={formId} ref={formElement} className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      {message && (
        <div tabIndex={-1} data-form-message="" className={styles.messageSlot}>
          <Notice tone="danger">{message}</Notice>
        </div>
      )}

      <Field label="Course name" error={errors.name} required>
        <Input
          ref={nameInput}
          name="name"
          value={form.name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          onChange={(event) => change({ name: event.target.value })}
          onBlur={onNameBlur}
        />
      </Field>

      <div className={styles.suggestRow}>
        <Button
          size="sm"
          variant="ghost"
          loading={suggesting}
          disabled={!form.name.trim()}
          onClick={() => requestSuggestion(form.name.trim())}
        >
          Suggest from name
        </Button>
        {suggested && <Notice tone="info">{SUGGESTED_NOTE}</Notice>}
      </div>

      <div className={styles.group}>
        <p className={styles.groupLabel}>Difficulty</p>
        <SegmentedControl
          label="Difficulty"
          options={DIFFICULTY_OPTIONS}
          value={String(form.difficulty)}
          onChange={(value) => change({ difficulty: Number(value) }, "difficulty")}
        />
        <p className={styles.hint}>1 is easy, 5 is hard.</p>
        {course && form.difficulty !== course.difficulty && (
          <Notice tone="info">
            This week&apos;s plan keeps its hours until you update it in <Link href="/planner">Planner</Link>.
          </Notice>
        )}
        {errors.difficulty && <p className={styles.error}>{errors.difficulty}</p>}
      </div>

      <fieldset className={styles.fieldset} aria-describedby={`${demandsLegend}-hint`}>
        <legend className={styles.groupLabel}>What does it ask of you?</legend>
        <p id={`${demandsLegend}-hint`} className={styles.hint}>
          Pick up to {MAX_DEMANDS}.
        </p>
        <div className={styles.checks}>
          {DEMAND_OPTIONS.map((option) => (
            <Checkbox
              key={option.value}
              label={option.label}
              name="learning_demands"
              value={option.value}
              checked={form.learningDemands.includes(option.value)}
              onChange={() => onDemandChange(option.value)}
            />
          ))}
        </div>
        <p role="status" className={styles.hint}>
          {capHint ? DEMAND_CAP_HINT : ""}
        </p>
        {errors.demands && <p className={styles.error}>{errors.demands}</p>}
      </fieldset>

      <div className={styles.group}>
        <p className={styles.groupLabel}>Builds on earlier topics</p>
        <SegmentedControl
          label="Builds on earlier topics"
          options={BUILDS_ON_OPTIONS}
          value={form.buildsOnEarlier}
          onChange={(value) => change({ buildsOnEarlier: value }, "buildsOnEarlier")}
        />
        {errors.buildsOn && <p className={styles.error}>{errors.buildsOn}</p>}
      </div>

      <Field label="How is it assessed?" error={errors.format}>
        <Select
          name="assessment_format"
          value={form.assessmentFormat}
          onChange={(event) => change({ assessmentFormat: event.target.value as AssessmentFormat | "" }, "assessmentFormat")}
        >
          <option value="">Not set</option>
          {FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Exam date" hint="Optional. Used for the countdown." error={errors.examDate}>
        <Input
          name="exam_date"
          type="date"
          value={form.examDate}
          onChange={(event) => change({ examDate: event.target.value }, "examDate")}
        />
      </Field>
    </form>
  );
}
