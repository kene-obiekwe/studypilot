"use client";

import Link from "next/link";
import { startTransition, Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange } from "lucide-react";

import { useTimeZone } from "@/components/app-shell/useTimeZone";
import { Button, EmptyState, Notice, Skeleton } from "@/components/ui";
import {
  getPlan,
  getSessionHistory,
  listCourses,
  listPlans,
  type Course,
  type SessionHistoryItem,
  type WeeklyPlan,
  type WeeklyPlanDetail,
} from "@/lib/api";
import { courseKey } from "@/lib/courses";
import { notifySessionsChanged } from "@/lib/timer-refresh";
import { useCourseColors } from "@/lib/use-course-colors";
import { currentPlanForWeek, daysLeft, weekStartKey } from "@/lib/week";

import { NextWeekCard, ThisWeekCard } from "./PlanCards";
import { PlanEditor } from "./PlanEditor";
import {
  canPlanAhead,
  dayLabel,
  defaultTarget,
  deletedCourses,
  deletedCoursesText,
  difficultyChangedText,
  difficultyChanges,
  draftFromPlan,
  draftSummary,
  isSaturday,
  isSunday,
  targetWeekStart,
  weekCard,
  type PlanDraft,
  type WeekTarget,
} from "./plan-model";
import styles from "./planner.module.css";

type PlannerData = {
  /** When the data was loaded: "today" for the whole view. */
  now: Date;
  /** The zone `now` was read in: the week and the plan fetched for it follow this zone. */
  zone: string;
  courses: Course[];
  plans: WeeklyPlan[];
  sessions: SessionHistoryItem[];
  /** This week's current plan with its earlier revisions, or null. */
  thisWeek: WeeklyPlanDetail | null;
};

type Loaded = PlannerData | { error: string };

/** Never rejects; a failure renders as a Notice with a retry. */
function loadPlanner(zone: string): Promise<Loaded> {
  const now = new Date();
  return Promise.all([listCourses(), listPlans(), getSessionHistory(), getPlan(weekStartKey(now, 0, zone), { revisions: true })]).then(
    ([courses, plans, history, thisWeek]) => ({ now, zone, courses, plans, sessions: history.items, thisWeek }),
    (failure: Error) => ({ error: failure.message }),
  );
}

export default function PlannerPage() {
  // Fetched once per page view (a lazy initialiser read with use(), not an effect); a reload swaps
  // the promise inside a transition, so the page keeps showing the old numbers until the new ones arrive.
  // The zone is the account's once the shell has loaded it; until then the last-known or the browser's,
  // and a change after the load fetches again for the right week.
  const zone = useTimeZone();
  const [promise, setPromise] = useState(() => loadPlanner(zone));
  const loadedZone = useRef(zone);
  const reload = useCallback(() => startTransition(() => setPromise(loadPlanner(loadedZone.current))), []);
  useEffect(() => {
    if (loadedZone.current === zone) return;
    loadedZone.current = zone;
    reload();
  }, [zone, reload]);
  return (
    <div className={styles.page}>
      <Suspense
        fallback={
          <div className={styles.section} aria-busy="true" aria-label="Loading your plan">
            <Skeleton height={160} />
            <Skeleton height={220} />
          </div>
        }
      >
        <Planner promise={promise} onReload={reload} />
      </Suspense>
    </div>
  );
}

function Planner({ promise, onReload }: { promise: Promise<Loaded>; onReload: () => void }) {
  const loaded = use(promise);
  if ("error" in loaded) {
    return (
      <Notice tone="danger" title="Could not load your plan">
        {loaded.error}{" "}
        <Button size="sm" variant="ghost" onClick={onReload}>
          Try again
        </Button>
      </Notice>
    );
  }
  return <PlannerView data={loaded} onReload={onReload} />;
}

function PlannerView({ data, onReload }: { data: PlannerData; onReload: () => void }) {
  const { now, zone, courses, plans, sessions } = data;
  const [chosenTarget, setChosenTarget] = useState<WeekTarget>(() => defaultTarget(now, zone));
  const [editing, setEditing] = useState(false);
  // Bumped whenever the form starts afresh (another week, a draft, opened again), to remount it.
  const [session, setSession] = useState(0);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [saved, setSaved] = useState<{ text: string; version: number } | null>(null);
  const savedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (saved) savedRef.current?.focus();
  }, [saved]);

  const { colorFor } = useCourseColors(courses);
  const idsByName = useMemo(() => new Map(courses.map((course) => [courseKey(course.name), course.id])), [courses]);
  const colorStyle = (name: string) => {
    const id = idsByName.get(courseKey(name));
    return id === undefined ? undefined : colorFor(id).style;
  };

  // A week planned ahead only on Saturday and Sunday; a reload on Monday falls back to this week.
  const target: WeekTarget = canPlanAhead(now, zone) ? chosenTarget : "this";
  const thisKey = weekStartKey(now, 0, zone);
  const nextKey = weekStartKey(now, 1, zone);
  const thisPlan = data.thisWeek ?? currentPlanForWeek(plans, thisKey) ?? null;
  const nextPlan = currentPlanForWeek(plans, nextKey) ?? null;
  const targetPlan = target === "next" ? nextPlan : thisPlan;
  const formOpen = editing || targetPlan === null;
  const sunday = isSunday(now, zone);

  // "Start from last week's plan": for next week, this week's plan is the one before it.
  const previousPlan = target === "next" ? thisPlan : (currentPlanForWeek(plans, weekStartKey(now, -1, zone)) ?? null);
  const draftOffer = targetPlan === null && draft === null && previousPlan ? draftFromPlan(previousPlan, courses) : null;

  const deleted = data.thisWeek ? deletedCourses(data.thisWeek) : null;
  // Shown only while the this-week card offers Update, so the notice and the button go together.
  const offersUpdate = thisPlan !== null && !(formOpen && target === "this");
  const changedDifficulty = offersUpdate ? difficultyChanges(thisPlan, courses) : [];

  const open = (week: WeekTarget) => {
    setChosenTarget(week);
    setEditing(true);
    setDraft(null);
    setSaved(null);
    setSession((count) => count + 1);
  };

  const close = () => {
    setEditing(false);
    setDraft(null);
    if (!isSunday(now, zone)) setChosenTarget("this");
    setSession((count) => count + 1);
  };

  const onSaved = (plan: WeeklyPlanDetail) => {
    const week = plan.week_start === nextKey ? "Next week's" : "This week's";
    setSaved((current) => ({ text: `${week} plan is saved.`, version: (current?.version ?? 0) + 1 }));
    setEditing(false);
    setDraft(null);
    // The sidebar meter and home read the plan too.
    notifySessionsChanged();
    onReload();
  };

  if (courses.length === 0 && thisPlan === null) {
    return (
      <EmptyState
        icon={<CalendarRange size={28} />}
        title="Add your courses first"
        description="A plan splits your weekly hours across the courses you study."
        action={
          <Link href="/courses" className={styles.linkButton}>
            Go to courses
          </Link>
        }
      />
    );
  }

  return (
    <>
      {saved && (
        <div ref={savedRef} tabIndex={-1} className={styles.focusWrap}>
          <Notice tone="success">{saved.text}</Notice>
        </div>
      )}

      {deleted && <Notice tone="warning">{deletedCoursesText(deleted)}</Notice>}
      {changedDifficulty.length > 0 && <Notice tone="warning">{difficultyChangedText(changedDifficulty)}</Notice>}

      {thisPlan && (
        <ThisWeekCard
          card={weekCard(thisPlan, sessions, now, zone)}
          days={daysLeft(now, zone)}
          colorStyle={colorStyle}
          onUpdate={formOpen && target === "this" ? undefined : () => open("this")}
        />
      )}

      {nextPlan && (
        <NextWeekCard plan={nextPlan} colorStyle={colorStyle} onEdit={formOpen && target === "next" ? undefined : () => open("next")} />
      )}

      {isSaturday(now, zone) && !nextPlan && target === "this" && (
        <p className={styles.aheadLink}>
          <Button variant="ghost" size="sm" onClick={() => open("next")}>
            Plan next week
          </Button>
          <span className={styles.muted}>Starts {dayLabel(nextKey)}.</span>
        </p>
      )}

      {formOpen && (
        <div className={styles.section}>
          {sunday && (
            <fieldset className={styles.weekChoice}>
              <legend className={styles.subTitle}>Which week?</legend>
              {(["this", "next"] as const).map((week) => (
                <label key={week} className={styles.radio}>
                  <input
                    type="radio"
                    name="week"
                    value={week}
                    checked={target === week}
                    onChange={() => open(week)}
                  />
                  {week === "this" ? "This week (ends today)" : `Next week (starts ${dayLabel(nextKey)})`}
                </label>
              ))}
            </fieldset>
          )}

          {draftOffer && (
            <div className={styles.addRow}>
              <Button
                onClick={() => {
                  setDraft(draftOffer);
                  setSession((count) => count + 1);
                }}
              >
                Start from {target === "next" ? "this" : "last"} week&apos;s plan ({draftSummary(draftOffer)})
              </Button>
            </div>
          )}

          <PlanEditor
            key={`${target}:${session}`}
            target={target}
            weekStart={targetWeekStart(now, target, zone)}
            plan={targetPlan}
            courses={courses}
            sessions={sessions}
            now={now}
            zone={zone}
            draft={draft}
            colorStyle={colorStyle}
            onSaved={onSaved}
            onRefresh={() => {
              notifySessionsChanged();
              onReload();
            }}
            onCancel={targetPlan !== null || (target === "next" && !sunday) ? close : undefined}
          />
        </div>
      )}
    </>
  );
}
