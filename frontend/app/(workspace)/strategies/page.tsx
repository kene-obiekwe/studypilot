"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Lightbulb, Settings2 } from "lucide-react";

import { PageAction } from "@/components/app-shell";
import { Button, Disclosure, EmptyState, Field, Notice, SegmentedControl, Select, Skeleton } from "@/components/ui";
import { getCourseRecommendations, showAgain, type CourseRecommendations } from "@/lib/api";
import type { CourseColor } from "@/lib/course-colors";
import { REST_EXPLANATION, restUntilLabel, restingLine, withoutResting } from "@/lib/strategy-feedback";
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

  // A course with everything resting has no recommendations but still shows its resting line.
  const withRecs = allCourses.filter((entry) => entry.recommendations.length > 0 || entry.resting.length > 0);
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
  // "Show again" and a written plan refetch this course alone; until then the data is what the page loaded with.
  const [refreshed, setRefreshed] = useState<CourseRecommendations | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [restingError, setRestingError] = useState("");
  const restingRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const refocusPlan = useRef(false);
  const current = refreshed ?? entry;
  const { course, evidence, recommendations } = current;
  const resting = current.resting.filter((item) => !pending.includes(item.strategy_id));
  const plan = useWeeklyPlan(course.id, entry.saved_plan ?? null);
  const collapsed = useCollapsedCourses().has(course.id);
  const headingId = `course-${course.id}-heading`;
  const panelId = `course-${course.id}-strategies`;
  const count = `${recommendations.length} ${recommendations.length === 1 ? "strategy" : "strategies"}`;
  const outdated = aiPlanAvailable ? outdatedNote(plan.saved) : "";

  // The strategies on screen follow the server's: it is what the plan is compared with.
  const refreshCourse = async (failedMessage: (reason: string) => string) => {
    try {
      const fresh = (await getCourseRecommendations(course.id)).courses[0];
      if (fresh) setRefreshed(fresh);
    } catch (failure) {
      setRestingError(failedMessage((failure as Error).message));
    }
  };

  const showStrategyAgain = async (strategyId: string) => {
    setRestingError("");
    // The button goes with its row, so move focus first: to the resting line while other
    // strategies are still resting, otherwise to the course panel, where the strategy is about to appear.
    const others = withoutResting(resting, strategyId);
    const target = others.length > 0 ? restingRef.current?.querySelector<HTMLElement>("summary") : panelRef.current;
    target?.focus();
    setPending((ids) => [...ids, strategyId]);
    try {
      const response = await showAgain(course.id, strategyId);
      plan.applyStatus(response.saved_plan);
    } catch (failure) {
      setPending((ids) => ids.filter((id) => id !== strategyId));
      setRestingError(`Couldn't show that again: ${(failure as Error).message}`);
      return;
    }
    await refreshCourse(
      (reason) => `Shown again, but couldn't refresh this course: ${reason}. Reload the page to see it.`,
    );
  };

  // Once a plan is written or updated, the list is refetched so it matches the plan: a strategy
  // rated Not helpful that is now resting moves into the resting list.
  const writePlan = async () => {
    setRestingError("");
    refocusPlan.current = true;
    if (!(await plan.write())) return;
    await refreshCourse(
      (reason) => `Plan written, but couldn't refresh this course's strategies: ${reason}. Reload the page to see them.`,
    );
  };

  // The Update button goes away once the plan is current; keep keyboard focus on the plan's own button.
  const planStatus = plan.state.status;
  useEffect(() => {
    if (!refocusPlan.current || planStatus === "loading") return;
    refocusPlan.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    sectionRef.current?.querySelector<HTMLElement>("[data-plan-toggle]")?.focus();
  }, [planStatus, plan.saved]);

  // Asking for the weekly plan opens a collapsed course, so the plan appears where it's expected.
  const expand = () => setCourseCollapsed(course.id, false);

  return (
    <section ref={sectionRef} className={styles.course} aria-labelledby={headingId} style={color.style}>
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
        {aiPlanAvailable && (recommendations.length > 0 || plan.saved !== null) && (
          <WeeklyPlanButton
            state={plan.state}
            saved={plan.saved}
            courseName={course.name}
            onWrite={() => {
              expand();
              void writePlan();
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
      <div id={panelId} ref={panelRef} tabIndex={-1} className={styles.coursePanel} hidden={collapsed}>
        <WeeklyPlanPanel state={plan.state} saved={plan.saved} courseName={course.name} />
        {recommendations.length === 0 ? (
          <p className={styles.allResting}>
            Every strategy that fits this course is resting for now. Show one again below, or check back when they return.
          </p>
        ) : (
          <ul className={styles.list} aria-label={`Strategies for ${course.name}`}>
            {recommendations.map((rec) => (
              <StrategyItem key={rec.shown_id} rec={rec} onPlanStatus={plan.applyStatus} />
            ))}
          </ul>
        )}
        {resting.length > 0 && (
          <div ref={restingRef} className={styles.resting}>
            <Disclosure summary={restingLine(resting.length)}>
              <div className={styles.restingBody}>
                <ul className={styles.restingList} aria-label={`Resting strategies for ${course.name}`}>
                  {resting.map((item) => (
                    <li key={item.strategy_id} className={styles.restingItem}>
                      <span>
                        <span className={styles.restingName}>{item.title}</span>{" "}
                        <span className={styles.restingUntil}>until {restUntilLabel(item.until)}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Show ${item.title} again`}
                        onClick={() => void showStrategyAgain(item.strategy_id)}
                      >
                        Show again
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className={styles.muted}>{REST_EXPLANATION}</p>
              </div>
            </Disclosure>
          </div>
        )}
        {restingError && <Notice tone="danger">{restingError}</Notice>}
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
