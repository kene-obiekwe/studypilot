"use client";

import { createContext, use, useState, type ReactNode } from "react";

import { getMe, getPlanHistory, getSessionHistory, type Me } from "@/lib/api";
import { summariseWeek, type WeekSummary } from "@/lib/week";

export type ShellData = {
  /** null when the request failed; the shell falls back to generic labels. */
  me: Me | null;
  /** null when the plan or session history couldn't be loaded. */
  week: WeekSummary | null;
};

/** Never rejects: each part degrades on its own. */
export function loadShellData(now: () => Date = () => new Date()): Promise<ShellData> {
  return Promise.allSettled([getMe(), getPlanHistory(), getSessionHistory()]).then(([me, plans, sessions]) => ({
    me: me.status === "fulfilled" ? me.value : null,
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
 */
export function ShellDataProvider({ children }: { children: ReactNode }) {
  const [promise] = useState(loadShellData);
  return <ShellDataContext.Provider value={promise}>{children}</ShellDataContext.Provider>;
}

export function useShellData(): ShellData {
  const promise = use(ShellDataContext);
  if (!promise) {
    throw new Error("useShellData must be used inside ShellDataProvider");
  }
  return use(promise);
}
