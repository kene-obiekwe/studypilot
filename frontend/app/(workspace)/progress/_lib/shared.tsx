"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getPlanHistory,
  getSessionHistory,
  getTrainingData,
  type PlanHistoryItem,
  type SessionHistoryItem,
  type TrainingDataItem,
} from "@/lib/api";
import { groupByCourse } from "@/lib/courses";
import { hasSession } from "@/lib/session";

// ---------------------------------------------------------------------------
// Shared progress data context — fetched once at the layout level so all
// progress sub-routes read from the same in-memory snapshot.
// ---------------------------------------------------------------------------

type ProgressContextValue = {
  signedIn: boolean;
  plans: PlanHistoryItem[];
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
    latestModelVersion: string;
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
  latestModelVersion: "-",
  difficultyMix: { low: 0, medium: 0, high: 0 },
};

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [plans, setPlans] = useState<PlanHistoryItem[]>([]);
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
  const [trainingRows, setTrainingRows] = useState<TrainingDataItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSignedIn(hasSession());
  }, []);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    setIsLoading(true);
    setError("");
    try {
      const [p, s, t] = await Promise.all([
        getPlanHistory(),
        getSessionHistory(),
        getTrainingData(),
      ]);
      setPlans(p.items);
      setSessions(s.items);
      setTrainingRows(t.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

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
    const latestModelVersion =
      sessions.find((item) => item.model_version && item.model_version.length > 0)?.model_version ?? "-";
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
      latestModelVersion,
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
