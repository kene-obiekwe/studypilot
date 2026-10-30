"use client";

import { useState } from "react";
import { NotebookPen, RefreshCw } from "lucide-react";

import { Button, Card, Notice, Skeleton } from "@/components/ui";
import {
  getCoursePlan,
  writeCoursePlan,
  type CoursePlan,
  type CoursePlanResponse,
  type SavedPlanStatus,
} from "@/lib/api";

import styles from "./strategies.module.css";

type PlanState =
  | { status: "idle" }
  | { status: "loading"; action: "show" | "write" }
  | { status: "ready"; plan: CoursePlan; open: boolean }
  | { status: "error"; message: string };

/** The plan on screen is the written AI plan, which can be hidden; a rules-only plan is only a stopgap. */
function shownAiPlan(state: PlanState): state is Extract<PlanState, { status: "ready" }> {
  return state.status === "ready" && state.plan.source === "ai";
}

function statusOf(response: CoursePlanResponse): SavedPlanStatus | null {
  if (response.written_at === null) return null;
  return {
    written_at: response.written_at,
    outdated: response.outdated,
    new_sessions: response.new_sessions,
    course_changed: response.course_changed,
    strategies_changed: response.strategies_changed,
  };
}

/** "5 Mar 2026": UK order whatever the browser's locale, like the rest of the app. */
function writtenOn(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** What happened since the plan was written, in one sentence. Empty when the plan is up to date. */
export function outdatedNote(saved: SavedPlanStatus | null): string {
  if (!saved?.outdated) return "";
  const did: string[] = [];
  if (saved.new_sessions > 0) did.push(`logged ${saved.new_sessions} ${saved.new_sessions === 1 ? "session" : "sessions"}`);
  if (saved.course_changed) did.push("changed this course's settings");
  if (saved.strategies_changed) did.push("changed your strategy ratings");
  // An outdated plan always has a reason; if the server sent none, say what is likeliest.
  if (did.length === 0) did.push("logged new sessions");
  const last = did.pop() as string;
  const list = did.length > 0 ? `${did.join(", ")} and ${last}` : last;
  return `You've ${list} since this plan was written`;
}

/**
 * Opening a saved plan only reads it; writing is explicit, and offered while there is no plan
 * this week or something changed since it was written. The controls follow what is saved:
 * nothing -> "Write my weekly plan"; saved -> "Show weekly plan", plus "Update plan" once outdated.
 * sectionOpen is false while the course is collapsed, when the plan isn't visible either.
 */
export function WeeklyPlanButton({
  state,
  saved,
  courseName,
  onWrite,
  onShow,
  onToggle,
  sectionOpen = true,
}: {
  state: PlanState;
  saved: SavedPlanStatus | null;
  courseName: string;
  onWrite: () => void;
  onShow: () => void;
  onToggle: () => void;
  sectionOpen?: boolean;
}) {
  const writing = state.status === "loading" && state.action === "write";
  const showing = state.status === "loading" && state.action === "show";

  if (saved === null) {
    return (
      <Button size="sm" variant="secondary" icon={<NotebookPen size={14} />} loading={writing} onClick={onWrite}>
        Write my weekly plan
      </Button>
    );
  }

  const aiPlan = shownAiPlan(state);
  const visible = aiPlan && state.open && sectionOpen;
  return (
    <div className={styles.planActions}>
      <Button
        size="sm"
        variant="secondary"
        icon={<NotebookPen size={14} />}
        aria-expanded={aiPlan ? visible : undefined}
        loading={showing}
        disabled={writing}
        onClick={aiPlan ? onToggle : onShow}
      >
        {visible ? "Hide weekly plan" : "Show weekly plan"}
      </Button>
      {saved.outdated && (
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={14} />}
          aria-label={`Update plan for ${courseName}`}
          loading={writing}
          disabled={showing}
          onClick={onWrite}
        >
          Update plan
        </Button>
      )}
    </div>
  );
}

export function useWeeklyPlan(courseId: number, initialSaved: SavedPlanStatus | null) {
  const [state, setState] = useState<PlanState>({ status: "idle" });
  const [saved, setSaved] = useState(initialSaved);

  const run = async (action: "show" | "write") => {
    setState({ status: "loading", action });
    try {
      const response = await (action === "write" ? writeCoursePlan(courseId) : getCoursePlan(courseId));
      setSaved(statusOf(response));
      setState(response.saved ? { status: "ready", plan: response.saved, open: true } : { status: "idle" });
    } catch (failure) {
      setState({ status: "error", message: (failure as Error).message });
    }
  };
  const toggle = () => setState((current) => (current.status === "ready" ? { ...current, open: !current.open } : current));
  return { state, saved, write: () => run("write"), show: () => run("show"), toggle };
}

export function WeeklyPlanPanel({
  state,
  saved,
  courseName,
}: {
  state: PlanState;
  saved: SavedPlanStatus | null;
  courseName: string;
}) {
  if (state.status === "loading") {
    return (
      <Card
        aria-busy="true"
        aria-label={state.action === "write" ? `Writing the weekly plan for ${courseName}` : `Loading the weekly plan for ${courseName}`}
      >
        <div className={styles.skeletonList}>
          <Skeleton width="40%" height={12} />
          <Skeleton />
          <Skeleton width="85%" />
          <Skeleton width="70%" />
        </div>
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Notice tone="danger" title="Couldn't load the weekly plan">
        {state.message}
      </Notice>
    );
  }
  if (state.status !== "ready" || !state.open) return null;

  const { plan } = state;
  const written = plan.source === "ai" && saved ? writtenOn(saved.written_at) : "";
  return (
    <Card as="section" aria-label={`Weekly plan for ${courseName}`}>
      <div className={styles.plan}>
        <p className={styles.planLabel}>{plan.source === "ai" ? "Written by AI from your data" : "Your plan, based on your data"}</p>
        {written && <p className={styles.muted}>Written {written}</p>}
        <p className={styles.planIntro}>{plan.intro}</p>
        <ol className={styles.planItems}>
          {plan.items.map((item) => (
            <li key={item.strategy_id}>
              <span className={styles.planItemTitle}>{item.title}</span>
              <p className={styles.planItemBody}>{item.body}</p>
            </li>
          ))}
        </ol>
        {plan.source === "rules" && (
          <p className={styles.muted}>
            {plan.throttled
              ? "AI plans are paused for today; showing your rule-based plan."
              : "The AI plan couldn't be written this time; showing your rule-based plan."}
          </p>
        )}
      </div>
    </Card>
  );
}
