"use client";

import { Suspense, use, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Lightbulb, Settings2 } from "lucide-react";

import { PageAction } from "@/components/app-shell";
import { Button, EmptyState, Field, Notice, SegmentedControl, Select, Skeleton } from "@/components/ui";
import { getCourseRecommendations, type CourseRecommendations } from "@/lib/api";
import type { CourseColor } from "@/lib/course-colors";
import { useCourseColors } from "@/lib/use-course-colors";

import { setCourseCollapsed, useCollapsedCourses } from "./collapsed-courses";
import { StrategyItem } from "./StrategyItem";
import { WeeklyPlanButton, WeeklyPlanPanel, outdatedNote, useWeeklyPlan } from "./WeeklyPlan";
import styles from "./strategies.module.css";

const NO_COURSES: CourseRecommendations[] = [];

type Loaded = { courses: CourseRecommendations[]; aiPlanAvailable: boolean } | { error: string };

/** Never rejects, so use() never throws into an error boundary; failures render as a Notice. */
function loadStrategies(): Promise<Loaded> {
  return getCourseRecommendations().then(
    (response) => ({ courses: response.courses, aiPlanAvailable: response.ai_plan_available }),
    (error: Error) => ({ error: error.message }),
  );
}

export default function StrategiesPage() {
  // One request per page view: a lazy initialiser, read with use() below. (React StrictMode
  // mounts twice in development, so dev shows two requests; production makes one.)
  const [promise, setPromise] = useState(loadStrategies);

  return (
    <div className={styles.page}>
      <PageAction>
        <Link href="/courses" className={styles.secondaryLink}>
          <Settings2 size={16} aria-hidden="true" />
          Manage courses
        </Link>
      </PageAction>
      <Suspense fallback={<StrategiesSkeleton />}>
        <Strategies promise={promise} onRetry={() => setPromise(loadStrategies())} />
      </Suspense>
    </div>
  );
}

function Strategies({ promise, onRetry }: { promise: Promise<Loaded>; onRetry: () => void }) {
  const loaded = use(promise);
  // Colours come from the full course list, so they match /courses even when a course is hidden here.
  const allCourses = "courses" in loaded ? loaded.courses : NO_COURSES;
  const courseIds = useMemo(() => allCourses.map((entry) => ({ id: entry.course.id })), [allCourses]);
  const { colorFor } = useCourseColors(courseIds);
  const [filter, setFilter] = useState("all");

  if ("error" in loaded) {
    return (
      <Notice tone="danger" title="Could not load your strategies">
        <p>{loaded.error}</p>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </Notice>
    );
  }

  if (allCourses.length === 0) {
    return (
      <EmptyState
        icon={<Lightbulb size={24} />}
        title="Add a course to get strategies"
        description="Strategies are matched to each course's settings and to the sessions you log."
        action={
          <Link href="/courses" className={styles.secondaryLink}>
            Go to courses
          </Link>
        }
      />
    );
  }

  const withRecs = allCourses.filter((entry) => entry.recommendations.length > 0);
  if (withRecs.length === 0) {
    return <p className={styles.muted}>No strategies for your courses yet. Log a few sessions and check back.</p>;
  }

  const options = [
    { value: "all", label: "All courses" },
    ...withRecs.map((entry) => ({ value: String(entry.course.id), label: entry.course.name })),
  ];
  const active = options.some((option) => option.value === filter) ? filter : "all";
  const shown = active === "all" ? withRecs : withRecs.filter((entry) => String(entry.course.id) === active);

  return (
    <>
      {withRecs.length > 1 && (
        <div>
          <div className={styles.filterDesktop}>
            <SegmentedControl label="Show strategies for" options={options} value={active} onChange={setFilter} />
          </div>
          <div className={styles.filterPhone}>
            <Field label="Show strategies for">
              <Select value={active} onChange={(event) => setFilter(event.target.value)}>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      )}
      {shown.map((entry) => (
        <CourseSection
          key={entry.course.id}
          entry={entry}
          color={colorFor(entry.course.id)}
          aiPlanAvailable={loaded.aiPlanAvailable}
        />
      ))}
    </>
  );
}

function CourseSection({
  entry,
  color,
  aiPlanAvailable,
}: {
  entry: CourseRecommendations;
  color: CourseColor;
  /** With AI plans off the weekly plan only restates the checklist, so the button is hidden. */
  aiPlanAvailable: boolean;
}) {
  const { course, evidence, recommendations } = entry;
  const plan = useWeeklyPlan(course.id, entry.saved_plan ?? null);
  const collapsed = useCollapsedCourses().has(course.id);
  const headingId = `course-${course.id}-heading`;
  const panelId = `course-${course.id}-strategies`;
  const count = `${recommendations.length} ${recommendations.length === 1 ? "strategy" : "strategies"}`;
  const outdated = aiPlanAvailable ? outdatedNote(plan.saved) : "";

  // Asking for the weekly plan opens a collapsed course, so the plan appears where it's expected.
  const expand = () => setCourseCollapsed(course.id, false);

  return (
    <section className={styles.course} aria-labelledby={headingId} style={color.style}>
      <div className={styles.courseHead}>
        <div className={styles.courseHeading}>
          <h2 id={headingId} className={styles.courseTitle}>
            <button
              type="button"
              className={styles.courseToggle}
              aria-expanded={!collapsed}
              aria-controls={panelId}
              onClick={() => setCourseCollapsed(course.id, !collapsed)}
            >
              <ChevronDown size={18} className={styles.courseChevron} aria-hidden="true" />
              <span className={styles.dot} aria-hidden="true" />
              {course.name}
            </button>
          </h2>
          <p className={styles.evidence}>
            {count} · {evidence.summary}
          </p>
          {outdated && <p className={styles.outdatedNote}>{outdated}</p>}
        </div>
        {aiPlanAvailable && (
          <WeeklyPlanButton
            state={plan.state}
            saved={plan.saved}
            courseName={course.name}
            onWrite={() => {
              expand();
              void plan.write();
            }}
            onShow={() => {
              expand();
              void plan.show();
            }}
            onToggle={() => {
              if (!collapsed) {
                plan.toggle();
                return;
              }
              expand();
              if (plan.state.status === "ready" && !plan.state.open) plan.toggle();
            }}
            sectionOpen={!collapsed}
          />
        )}
      </div>
      <div id={panelId} className={styles.coursePanel} hidden={collapsed}>
        <WeeklyPlanPanel state={plan.state} saved={plan.saved} courseName={course.name} />
        <ul className={styles.list} aria-label={`Strategies for ${course.name}`}>
          {recommendations.map((rec) => (
            <StrategyItem key={rec.shown_id} rec={rec} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function StrategiesSkeleton() {
  return (
    <div className={styles.skeletonList} aria-busy="true" aria-label="Loading strategies">
      <Skeleton width={220} height={24} />
      <Skeleton width="60%" />
      <Skeleton height={120} radius="lg" />
      <Skeleton height={120} radius="lg" />
    </div>
  );
}
