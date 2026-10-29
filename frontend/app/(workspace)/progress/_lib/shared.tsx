"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  getSessionHistory,
  getTrainingData,
  listPlans,
  type SessionHistoryItem,
  type TrainingDataItem,
  type WeeklyPlan,
} from "@/lib/api";
import { groupByCourse } from "@/lib/courses";
import { hasSession } from "@/lib/session";
import { onSessionsChanged } from "@/lib/timer-refresh";

// ---------------------------------------------------------------------------
// Shared progress data context — fetched once at the layout level so all
// progress sub-routes read from the same in-memory snapshot.
// ---------------------------------------------------------------------------

type ProgressContextValue = {
  signedIn: boolean;
  /** The current plan of each week, newest week first. */
  plans: WeeklyPlan[];
  sessions: SessionHistoryItem[];
  trainingRows: TrainingDataItem[];
  isLoading: boolean;
  error: string;
  refresh: () => Promise<void>;
  analytics: {
    avgAdherence: number;
    avgPredicted: number;
    avgFocus: number;
    avgCompletion: number;
    totalPlannedMinutes: number;
    totalActualMinutes: number;
    topCourse: string;
    topCourseSessions: number;
    weeklyIntensity: number;
    difficultyMix: { low: number; medium: number; high: number };
  };
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

const EMPTY_ANALYTICS: ProgressContextValue["analytics"] = {
  avgAdherence: 0,
  avgPredicted: 0,
  avgFocus: 0,
  avgCompletion: 0,
  totalPlannedMinutes: 0,
  totalActualMinutes: 0,
  topCourse: "-",
  topCourseSessions: 0,
  weeklyIntensity: 0,
  difficultyMix: { low: 0, medium: 0, high: 0 },
};

type Snapshot = { plans: WeeklyPlan[]; sessions: SessionHistoryItem[]; trainingRows: TrainingDataItem[] };

const EMPTY_SNAPSHOT: Snapshot = { plans: [], sessions: [], trainingRows: [] };

function fetchSnapshot(): Promise<Snapshot> {
  return Promise.all([listPlans(), getSessionHistory(), getTrainingData()]).then(([p, s, t]) => ({
    plans: p,
    sessions: s.items,
    trainingRows: t.rows,
  }));
}

// Re-check when another tab signs in or out (localStorage "storage" events).
function subscribeSession(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  // False on the server and during hydration, then the real answer.
  const signedIn = useSyncExternalStore(subscribeSession, hasSession, () => false);
  const [{ plans, sessions, trainingRows }, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Never rejects. State is only set in the callbacks, once the requests have settled.
  const load = useCallback(
    () =>
      fetchSnapshot().then(
        (next) => {
          setSnapshot(next);
          setError("");
          setLoaded(true);
        },
        (failure: Error) => {
          setError(failure.message);
          setLoaded(true);
        },
      ),
    [],
  );

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    setRefreshing(true);
    setError("");
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [signedIn, load]);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  // A session saved by the timer (here or in another tab) changes everything these views show.
  useEffect(() => (signedIn ? onSessionsChanged(() => void refresh()) : undefined), [signedIn, refresh]);

  const isLoading = signedIn && (!loaded || refreshing);

  const analytics = useMemo(() => {
    if (sessions.length === 0) {
      return EMPTY_ANALYTICS;
    }
    const totals = sessions.reduce(
      (acc, item) => {
        acc.adherence += item.adherence_score;
        if (typeof item.predicted_adherence === "number") {
          acc.predicted += item.predicted_adherence;
          acc.predictedCount += 1;
        }
        acc.focus += item.focus_score;
        acc.completion += item.completion_rate;
        acc.planned += item.planned_minutes;
        acc.actual += item.actual_minutes;
        return acc;
      },
      { adherence: 0, predicted: 0, predictedCount: 0, focus: 0, completion: 0, planned: 0, actual: 0 },
    );
    let topCourse = "-";
    let topCourseSessions = 0;
    groupByCourse(sessions).forEach(({ label, count }) => {
      if (count > topCourseSessions) {
        topCourse = label;
        topCourseSessions = count;
      }
    });
    const weeklyIntensity =
      trainingRows.length > 0
        ? trainingRows.reduce((acc, row) => acc + row.sessions_last_7_days, 0) / trainingRows.length
        : 0;
    const difficultyMix = trainingRows.reduce(
      (acc, row) => {
        if (row.difficulty <= 2) acc.low += 1;
        else if (row.difficulty === 3) acc.medium += 1;
        else acc.high += 1;
        return acc;
      },
      { low: 0, medium: 0, high: 0 },
    );
    return {
      avgAdherence: totals.adherence / sessions.length,
      avgPredicted: totals.predictedCount > 0 ? totals.predicted / totals.predictedCount : 0,
      avgFocus: totals.focus / sessions.length,
      avgCompletion: totals.completion / sessions.length,
      totalPlannedMinutes: totals.planned,
      totalActualMinutes: totals.actual,
      topCourse,
      topCourseSessions,
      weeklyIntensity,
      difficultyMix,
    };
  }, [sessions, trainingRows]);

  const value: ProgressContextValue = {
    signedIn,
    plans,
    sessions,
    trainingRows,
    isLoading,
    error,
    refresh,
    analytics,
  };

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) {
    throw new Error("useProgress must be used inside a ProgressProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Tiny formatter helpers used across pages
// ---------------------------------------------------------------------------

export function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value * 100));
}
