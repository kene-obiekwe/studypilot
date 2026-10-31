"use client";

import { createContext, startTransition, use, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { getMe, getSessionHistory, listPlans, type Me, type SessionHistoryItem, type WeeklyPlan } from "@/lib/api";
import { onSessionsChanged } from "@/lib/timer-refresh";
import { loggedHoursThisWeek, summariseWeek, type PlanLike, type WeekSummary } from "@/lib/week";
import { effectiveZone, rememberZone } from "@/lib/zone";

import { TimeZoneContext } from "./useTimeZone";
import { onZoneSynced, syncTimeZone } from "./zone-sync";

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
export function excludedHoursThisWeek(
  plans: readonly PlanLike[],
  sessions: readonly SessionHistoryItem[],
  now: Date,
  zone?: string,
): number {
  const everything = loggedHoursThisWeek(sessions, now, undefined, zone);
  const counted = loggedHoursThisWeek(sessions, now, plans, zone);
  return Math.max(0, everything - counted);
}

/** Never rejects: each part degrades on its own. */
export function loadShellData(now: () => Date = () => new Date()): Promise<ShellData> {
  return Promise.allSettled([getMe(), listPlans(), getSessionHistory()]).then(([me, plans, sessions]) => {
    const at = now();
    // The week is decided in the account's zone, which the account itself tells us.
    const zone = effectiveZone(me.status === "fulfilled" ? me.value : undefined);
    const both = plans.status === "fulfilled" && sessions.status === "fulfilled";
    return {
      me: me.status === "fulfilled" ? me.value : null,
      plans: plans.status === "fulfilled" ? plans.value : null,
      sessions: sessions.status === "fulfilled" ? sessions.value.items : null,
      week: both ? summariseWeek(plans.value, sessions.value.items, at, zone) : null,
      excludedHours: both ? excludedHoursThisWeek(plans.value, sessions.value.items, at, zone) : 0,
    };
  });
}

const ShellDataContext = createContext<Promise<ShellData> | null>(null);
const ShellRefreshContext = createContext<() => void>(() => undefined);

/**
 * Starts the shell's requests once per mount (a lazy state initialiser, not an effect) and
 * shares the promise. Readers call useShellData() inside a Suspense boundary.
 * When a session is logged (lib/timer-refresh.ts) it fetches again inside a transition, so the
 * meter keeps showing the old numbers until the new ones arrive instead of a skeleton. The account
 * page does the same after a username or email change (useRefreshShellData).
 * It also publishes the account's zone (useTimeZone) and, when the account follows the device,
 * sends the browser's zone if it differs (zone-sync.ts); a sync the server accepts refreshes the data.
 */
export function ShellDataProvider({ children }: { children: ReactNode }) {
  const [promise, setPromise] = useState(loadShellData);
  const refresh = useCallback(() => startTransition(() => setPromise(loadShellData())), []);
  useEffect(() => onSessionsChanged(refresh), [refresh]);
  useEffect(() => onZoneSynced(refresh), [refresh]);

  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void promise.then(({ me }) => {
      if (!current) return;
      const resolved = effectiveZone(me);
      if (me) rememberZone(resolved);
      setZone(resolved);
      void syncTimeZone(me);
    });
    return () => {
      current = false;
    };
  }, [promise]);

  return (
    <ShellRefreshContext.Provider value={refresh}>
      <TimeZoneContext.Provider value={zone}>
        <ShellDataContext.Provider value={promise}>{children}</ShellDataContext.Provider>
      </TimeZoneContext.Provider>
    </ShellRefreshContext.Provider>
  );
}

/** Fetch the shell's data again, keeping what is on screen until it arrives. */
export function useRefreshShellData(): () => void {
  return useContext(ShellRefreshContext);
}

export function useShellData(): ShellData {
  const promise = use(ShellDataContext);
  if (!promise) {
    throw new Error("useShellData must be used inside ShellDataProvider");
  }
  return use(promise);
}
