"use client";

import { startTransition, Suspense, use, useId, useState, type ReactNode } from "react";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";

import { PageAction } from "@/components/app-shell";
import { useTimeZone } from "@/components/app-shell/useTimeZone";
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

const NO_COURSES: Course[] = [];

type Loaded = { courses: Course[] } | { error: string };

/** Never rejects; a failure renders as a Notice with a retry. */
function loadCourses(): Promise<Loaded> {
  return listCourses().then(
    (courses) => ({ courses }),
    (failure: Error) => ({ error: failure.message }),
  );
}

export default function CoursesPage() {
  // Fetched once per page view (a lazy initialiser read with use(), not an effect). After a change
  // it is fetched again inside a transition, so the list stays on screen until the new one arrives.
  const [promise, setPromise] = useState(loadCourses);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleting, setDeleting] = useState<Course | null>(null);
  const [status, setStatus] = useState("");

  const reload = () => startTransition(() => setPromise(loadCourses()));

  const save = async (input: CourseInput) => {
    if (dialog?.mode === "edit") {
      await updateCourse(dialog.course.id, input);
      setStatus(`Saved ${input.name}.`);
    } else {
      await createCourse(input);
      setStatus(`Added ${input.name}.`);
    }
    setDialog(null);
    reload();
  };

  const remove = async (course: Course) => {
    await deleteCourse(course.id);
    setDeleting(null);
    setStatus(`Deleted ${course.name}.`);
    reload();
  };

  const addAction = (
    <PageAction>
      <Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog({ mode: "add" })}>
        Add course
      </Button>
    </PageAction>
  );

  return (
    <div className={styles.page}>
      {status && <Notice tone="success">{status}</Notice>}

      <Suspense
        fallback={
          <>
            {addAction}
            <div className={styles.skeletonList} aria-busy="true" aria-label="Loading courses">
              <Skeleton height={72} />
              <Skeleton height={72} />
              <Skeleton height={72} />
            </div>
          </>
        }
      >
        <CourseList
          promise={promise}
          addAction={addAction}
          onReload={reload}
          onAdd={() => setDialog({ mode: "add" })}
          onEdit={(course) => setDialog({ mode: "edit", course })}
          onDelete={setDeleting}
        />
      </Suspense>

      {dialog && <CourseDialog state={dialog} onSave={save} onClose={() => setDialog(null)} />}
      {deleting && <DeleteDialog course={deleting} onConfirm={remove} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function CourseList({
  promise,
  addAction,
  onReload,
  onAdd,
  onEdit,
  onDelete,
}: {
  promise: Promise<Loaded>;
  addAction: ReactNode;
  onReload: () => void;
  onAdd: () => void;
  onEdit: (course: Course) => void;
  onDelete: (course: Course) => void;
}) {
  const loaded = use(promise);
  const courses = "courses" in loaded ? loaded.courses : NO_COURSES;
  const { colorFor } = useCourseColors(courses);
  const zone = useTimeZone();

  if ("error" in loaded) {
    return (
      <>
        {addAction}
        <Notice tone="danger" title="Could not load your courses">
          {loaded.error}{" "}
          <Button size="sm" variant="ghost" onClick={onReload}>
            Try again
          </Button>
        </Notice>
      </>
    );
  }

  const now = new Date();

  if (courses.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={28} />}
        title="Add your first course"
        description="Plans, strategies and forecasts are built per course."
        action={
          <Button variant="primary" icon={<Plus size={16} />} onClick={onAdd}>
            Add course
          </Button>
        }
      />
    );
  }

  return (
    <>
      {addAction}
      <ul className={styles.list}>
        {courses.map((course) => {
          const exam = examLabel(course.exam_date, now, zone);
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
                <Button size="sm" icon={<Pencil size={14} />} aria-label={`Edit ${course.name}`} onClick={() => onEdit(course)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Delete ${course.name}`} onClick={() => onDelete(course)}>
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
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
