"use client";

import { useId, useState } from "react";
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

/** Step 1: add the courses, one form at a time. The form is reset after each save. */
export function CoursesStep({ courses, colorFor, onAdded, onRemoved, onContinue }: Props) {
  const formId = useId();
  const [formKey, setFormKey] = useState(0);
  const [status, setStatus] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [removingId, setRemovingId] = useState<number | null>(null);

  const add = async (input: CourseInput) => {
    const course = await createCourse(input);
    onAdded(course);
    setStatus(`Added ${course.name}.`);
    setRemoveError("");
    setFormKey((key) => key + 1);
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
        <CourseForm key={formKey} formId={formId} onSubmit={add} />
        <div className={styles.actions}>
          <Button type="submit" form={formId}>
            Add course
          </Button>
        </div>
      </section>

      <div className={styles.footer}>
        <p id={`${formId}-hint`} className={styles.muted}>
          {courses.length === 0 ? "Add at least one course to continue." : "You can add more courses later."}
        </p>
        <Button variant="primary" disabled={courses.length === 0} aria-describedby={`${formId}-hint`} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
