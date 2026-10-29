"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";

import { Button, Notice } from "@/components/ui";
import { createCourse, deleteCourse, type Course, type CourseInput } from "@/lib/api";
import type { CourseColor } from "@/lib/course-colors";

import { CourseForm } from "../../(workspace)/courses/CourseForm";
import styles from "../onboarding.module.css";

type Props = {
  courses: Course[];
  colorFor: (courseId: number) => CourseColor;
  onAdded: (course: Course) => void;
  onRemoved: (courseId: number) => void;
  onContinue: () => void;
};

/**
 * Step 1: add the courses, one form at a time. The form is reset after each save. Continue adds a
 * course that is typed but not yet added (through the form's own submit), then moves on; if that
 * add fails the error shows on the form and the step stays.
 */
export function CoursesStep({ courses, colorFor, onAdded, onRemoved, onContinue }: Props) {
  const formId = useId();
  const [formKey, setFormKey] = useState(0);
  const [status, setStatus] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [hasTypedName, setHasTypedName] = useState(false);
  const [continuing, setContinuing] = useState(false);
  // Set while Continue is submitting the form, so a successful add goes on to the next step.
  const continueAfterAdd = useRef(false);
  const addStarted = useRef(false);

  const add = async (input: CourseInput) => {
    addStarted.current = true;
    try {
      const course = await createCourse(input);
      onAdded(course);
      setStatus(`Added ${course.name}.`);
      setRemoveError("");
      setHasTypedName(false);
      setFormKey((key) => key + 1);
      if (continueAfterAdd.current) onContinue();
    } finally {
      continueAfterAdd.current = false;
      setContinuing(false);
    }
  };

  const typedName = () =>
    document.getElementById(formId)?.querySelector<HTMLInputElement>("input[name='name']")?.value.trim() ?? "";

  const onFormInput = (event: FormEvent) => {
    if ((event.target as HTMLElement).getAttribute("name") === "name") setHasTypedName(typedName() !== "");
  };

  const continueClicked = () => {
    if (continuing) return;
    if (typedName() === "") {
      onContinue();
      return;
    }
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    continueAfterAdd.current = true;
    addStarted.current = false;
    setContinuing(true);
    form.requestSubmit();
    // The form's own checks failed before saving: it shows them, and we stay here.
    if (!addStarted.current) {
      continueAfterAdd.current = false;
      setContinuing(false);
    }
  };

  const remove = async (course: Course) => {
    setRemovingId(course.id);
    setRemoveError("");
    try {
      await deleteCourse(course.id);
      onRemoved(course.id);
      setStatus(`Removed ${course.name}.`);
    } catch (failure) {
      setRemoveError((failure as Error).message);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className={styles.step}>
      {courses.length > 0 && (
        <section aria-labelledby={`${formId}-added`} className={styles.step}>
          <h2 id={`${formId}-added`} className={styles.sectionTitle}>
            Your courses
          </h2>
          <ul className={styles.list}>
            {courses.map((course) => (
              <li key={course.id} className={styles.row} style={colorFor(course.id).style}>
                <span className={styles.dot} aria-hidden="true" />
                <p className={styles.rowName}>{course.name}</p>
                <p className={styles.rowMeta}>Difficulty {course.difficulty} of 5</p>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={14} />}
                  aria-label={`Remove ${course.name}`}
                  loading={removingId === course.id}
                  onClick={() => void remove(course)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {removeError && (
            <Notice tone="danger" title="Could not remove the course">
              {removeError}
            </Notice>
          )}
        </section>
      )}

      <p role="status" className={styles.muted}>
        {status}
      </p>

      <section aria-labelledby={`${formId}-add`} className={styles.step}>
        <h2 id={`${formId}-add`} className={styles.sectionTitle}>
          {courses.length === 0 ? "Add a course" : "Add another course"}
        </h2>
        <div onInput={onFormInput}>
          <CourseForm key={formKey} formId={formId} onSubmit={add} />
        </div>
        <div className={styles.actions}>
          <Button type="submit" form={formId}>
            Add course
          </Button>
        </div>
      </section>

      <div className={styles.footer}>
        <p id={`${formId}-hint`} className={styles.muted}>
          {courses.length === 0 && !hasTypedName ? "Add at least one course to continue." : "You can add more courses later."}
        </p>
        <Button
          variant="primary"
          disabled={courses.length === 0 && !hasTypedName}
          loading={continuing}
          aria-describedby={`${formId}-hint`}
          onClick={continueClicked}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
