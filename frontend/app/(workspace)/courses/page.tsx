"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";

import { PageAction } from "@/components/app-shell";
import { Badge, Button, Dialog, EmptyState, Notice, Skeleton } from "@/components/ui";
import {
  createCourse,
  deleteCourse,
  listCourses,
  updateCourse,
  type Course,
  type CourseInput,
} from "@/lib/api";
import { examLabel } from "@/lib/exam";
import { useCourseColors } from "@/lib/use-course-colors";

import { CourseForm } from "./CourseForm";
import { describeTraits, weeklyHoursLabel } from "./course-form";
import styles from "./courses.module.css";

type DialogState = { mode: "add" } | { mode: "edit"; course: Course } | null;

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleting, setDeleting] = useState<Course | null>(null);
  const [status, setStatus] = useState("");
  const { colorFor } = useCourseColors(courses ?? []);

  const load = useCallback(async () => {
    try {
      setCourses(await listCourses());
      setLoadError("");
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (input: CourseInput) => {
    if (dialog?.mode === "edit") {
      await updateCourse(dialog.course.id, input);
      setStatus(`Saved ${input.name}.`);
    } else {
      await createCourse(input);
      setStatus(`Added ${input.name}.`);
    }
    setDialog(null);
    await load();
  };

  const remove = async (course: Course) => {
    await deleteCourse(course.id);
    setDeleting(null);
    setStatus(`Deleted ${course.name}.`);
    await load();
  };

  const now = new Date();
  const empty = courses !== null && courses.length === 0;

  return (
    <div className={styles.page}>
      {!empty && (
        <PageAction>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog({ mode: "add" })}>
            Add course
          </Button>
        </PageAction>
      )}

      {status && <Notice tone="success">{status}</Notice>}
      {loadError && (
        <Notice tone="danger" title="Could not load your courses">
          {loadError}{" "}
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Try again
          </Button>
        </Notice>
      )}

      {courses === null && !loadError && (
        <div className={styles.skeletonList} aria-busy="true" aria-label="Loading courses">
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </div>
      )}

      {empty && (
        <EmptyState
          icon={<BookOpen size={28} />}
          title="Add your first course"
          description="Plans, strategies and forecasts are built per course."
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog({ mode: "add" })}>
              Add course
            </Button>
          }
        />
      )}

      {courses !== null && courses.length > 0 && (
        <ul className={styles.list}>
          {courses.map((course) => {
            const exam = examLabel(course.exam_date, now);
            const traits = describeTraits(course);
            const hasTraits = traits !== "No traits set yet";
            return (
              <li key={course.id} className={styles.row} style={colorFor(course.id).style}>
                <span className={styles.dot} aria-hidden="true" />
                <div className={styles.body}>
                  <div className={styles.titleLine}>
                    <h2 className={styles.name}>{course.name}</h2>
                    <p className={styles.meta}>
                      Difficulty {course.difficulty} of 5 · {weeklyHoursLabel(course.weekly_target_hours)}
                    </p>
                  </div>
                  <p className={hasTraits ? styles.traits : `${styles.traits} ${styles.traitsEmpty}`}>{traits}</p>
                  {exam && (
                    <div className={styles.badges}>
                      <Badge tone="exam">{exam}</Badge>
                    </div>
                  )}
                </div>
                <div className={styles.actions}>
                  <Button size="sm" icon={<Pencil size={14} />} aria-label={`Edit ${course.name}`} onClick={() => setDialog({ mode: "edit", course })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Delete ${course.name}`} onClick={() => setDeleting(course)}>
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog && <CourseDialog state={dialog} onSave={save} onClose={() => setDialog(null)} />}
      {deleting && <DeleteDialog course={deleting} onConfirm={remove} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function CourseDialog({
  state,
  onSave,
  onClose,
}: {
  state: NonNullable<DialogState>;
  onSave: (input: CourseInput) => Promise<void>;
  onClose: () => void;
}) {
  const formId = useId();
  const [saving, setSaving] = useState(false);
  const editing = state.mode === "edit";

  return (
    <Dialog
      open
      onClose={saving ? () => undefined : onClose}
      closeOnBackdrop={false}
      title={editing ? "Edit course" : "Add course"}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            Save course
          </Button>
        </>
      }
    >
      <CourseForm
        formId={formId}
        course={state.mode === "edit" ? state.course : undefined}
        onSubmit={async (input) => {
          setSaving(true);
          try {
            await onSave(input);
          } finally {
            setSaving(false);
          }
        }}
      />
    </Dialog>
  );
}

function DeleteDialog({
  course,
  onConfirm,
  onClose,
}: {
  course: Course;
  onConfirm: (course: Course) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm(course);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      title={`Delete ${course.name}?`}
      description="Your logged sessions and past plans stay in your history."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            Delete course
          </Button>
        </>
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
    </Dialog>
  );
}
