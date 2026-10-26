"use client";

import { useState } from "react";
import { NotebookPen } from "lucide-react";

import { Button, Card, Notice, Skeleton } from "@/components/ui";
import { getCoursePlan, type CoursePlan } from "@/lib/api";

import styles from "./strategies.module.css";

type PlanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; plan: CoursePlan; open: boolean }
  | { status: "error"; message: string };

/** "Write my weekly plan": fetched only when asked for, then shown (or hidden) under the course. */
export function WeeklyPlanButton({ state, onWrite, onToggle }: { state: PlanState; onWrite: () => void; onToggle: () => void }) {
  if (state.status === "ready") {
    return (
      <Button size="sm" variant="secondary" icon={<NotebookPen size={14} />} aria-expanded={state.open} onClick={onToggle}>
        {state.open ? "Hide weekly plan" : "Show weekly plan"}
      </Button>
    );
  }
  return (
    <Button size="sm" variant="secondary" icon={<NotebookPen size={14} />} loading={state.status === "loading"} onClick={onWrite}>
      Write my weekly plan
    </Button>
  );
}

export function useWeeklyPlan(courseId: number) {
  const [state, setState] = useState<PlanState>({ status: "idle" });
  const write = async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", plan: await getCoursePlan(courseId), open: true });
    } catch (failure) {
      setState({ status: "error", message: (failure as Error).message });
    }
  };
  const toggle = () => setState((current) => (current.status === "ready" ? { ...current, open: !current.open } : current));
  return { state, write, toggle };
}

export function WeeklyPlanPanel({ state, courseName }: { state: PlanState; courseName: string }) {
  if (state.status === "loading") {
    return (
      <Card aria-busy="true" aria-label={`Writing the weekly plan for ${courseName}`}>
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
      <Notice tone="danger" title="Couldn't write the weekly plan">
        {state.message}
      </Notice>
    );
  }
  if (state.status !== "ready" || !state.open) return null;

  const { plan } = state;
  return (
    <Card as="section" aria-label={`Weekly plan for ${courseName}`}>
      <div className={styles.plan}>
        <p className={styles.planLabel}>{plan.source === "ai" ? "Written by AI from your data" : "Your plan, based on your data"}</p>
        <p className={styles.planIntro}>{plan.intro}</p>
        <ol className={styles.planItems}>
          {plan.items.map((item) => (
            <li key={item.strategy_id}>
              <span className={styles.planItemTitle}>{item.title}</span>
              <p className={styles.planItemBody}>{item.body}</p>
            </li>
          ))}
        </ol>
        {plan.throttled && <p className={styles.muted}>AI plans are paused for today; showing your rule-based plan.</p>}
      </div>
    </Card>
  );
}
