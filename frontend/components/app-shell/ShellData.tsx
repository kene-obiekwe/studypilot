"use client";

import { createContext, startTransition, use, useEffect, useState, type ReactNode } from "react";

import { getMe, getSessionHistory, listPlans, type Me, type SessionHistoryItem, type WeeklyPlan } from "@/lib/api";
import { onSessionsChanged } from "@/lib/timer-refresh";
import { loggedHoursThisWeek, summariseWeek, type PlanLike, type WeekSummary } from "@/lib/week";

export type ShellData = {
  /** null when the request failed; the shell falls back to generic labels. */
  me: Me | null;
  /** null when the plan or session history couldn't be loaded. */
  week: WeekSummary | null;
  /** The raw histories behind `week`, shared with the home page; null when that request failed. */
  plans: WeeklyPlan[] | null;
  sessions: SessionHistoryItem[] | null;
  /** Hours logged this week on courses that don't count toward the plan (0 with no plan). */
  excludedHours: number;
};

/** Logged this week but left out of the meter: the courses taken out of, or never in, this week's plan. */
export function excludedHoursThisWeek(plans: readonly PlanLike[], sessions: readonly SessionHistoryItem[], now: Date): number {
  const everything = loggedHoursThisWeek(sessions, now);
  const counted = loggedHoursThisWeek(sessions, now, plans);
  return Math.max(0, everything - counted);
}

/** Never rejects: each part degrades on its own. */
export function loadShellData(now: () => Date = () => new Date()): Promise<ShellData> {
  return Promise.allSettled([getMe(), listPlans(), getSessionHistory()]).then(([me, plans, sessions]) => {
    const at = now();
    const both = plans.status === "fulfilled" && sessions.status === "fulfilled";
    return {
      me: me.status === "fulfilled" ? me.value : null,
      plans: plans.status === "fulfilled" ? plans.value : null,
      sessions: sessions.status === "fulfilled" ? sessions.value.items : null,
      week: both ? summariseWeek(plans.value, sessions.value.items, at) : null,
      excludedHours: both ? excludedHoursThisWeek(plans.value, sessions.value.items, at) : 0,
    };
  });
}

const ShellDataContext = createContext<Promise<ShellData> | null>(null);

/**
 * Starts the shell's requests once per mount (a lazy state initialiser, not an effect) and
 * shares the promise. Readers call useShellData() inside a Suspense boundary.
 * When a session is logged (lib/timer-refresh.ts) it fetches again inside a transition, so the
 * meter keeps showing the old numbers until the new ones arrive instead of a skeleton.
 */
export function ShellDataProvider({ children }: { children: ReactNode }) {
  const [promise, setPromise] = useState(loadShellData);
  useEffect(() => onSessionsChanged(() => startTransition(() => setPromise(loadShellData()))), []);
  return <ShellDataContext.Provider value={promise}>{children}</ShellDataContext.Provider>;
}

export function useShellData(): ShellData {
  const promise = use(ShellDataContext);
  if (!promise) {
    throw new Error("useShellData must be used inside ShellDataProvider");
  }
  return use(promise);
}
