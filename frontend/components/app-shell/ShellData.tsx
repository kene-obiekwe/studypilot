"use client";

import { createContext, startTransition, use, useEffect, useState, type ReactNode } from "react";

import {
  getMe,
  getPlanHistory,
  getSessionHistory,
  type Me,
  type PlanHistoryItem,
  type SessionHistoryItem,
} from "@/lib/api";
import { onSessionsChanged } from "@/lib/timer-refresh";
import { summariseWeek, type WeekSummary } from "@/lib/week";

export type ShellData = {
  /** null when the request failed; the shell falls back to generic labels. */
  me: Me | null;
  /** null when the plan or session history couldn't be loaded. */
  week: WeekSummary | null;
  /** The raw histories behind `week`, shared with the home page; null when that request failed. */
  plans: PlanHistoryItem[] | null;
  sessions: SessionHistoryItem[] | null;
};

/** Never rejects: each part degrades on its own. */
export function loadShellData(now: () => Date = () => new Date()): Promise<ShellData> {
  return Promise.allSettled([getMe(), getPlanHistory(), getSessionHistory()]).then(([me, plans, sessions]) => ({
    me: me.status === "fulfilled" ? me.value : null,
    plans: plans.status === "fulfilled" ? plans.value.items : null,
    sessions: sessions.status === "fulfilled" ? sessions.value.items : null,
    week:
      plans.status === "fulfilled" && sessions.status === "fulfilled"
        ? summariseWeek(plans.value.items, sessions.value.items, now())
        : null,
  }));
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
