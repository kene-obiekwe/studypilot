"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ClipboardCheck, History, LineChart, Sparkles } from "lucide-react";

import {
  getPlanHistory,
  getRecommendationHistory,
  getSessionHistory,
  getTrainingData,
  type PlanHistoryItem,
  type RecommendationHistoryItem,
  type SessionHistoryItem,
  type TrainingDataItem,
} from "@/lib/api";
import { getStoredToken } from "@/lib/session";

// ---------------------------------------------------------------------------
// Shared progress data context — fetched once at the layout level so all
// progress sub-routes read from the same in-memory snapshot.
// ---------------------------------------------------------------------------

type ProgressContextValue = {
  token: string;
  plans: PlanHistoryItem[];
  recommendations: RecommendationHistoryItem[];
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
  const [token, setToken] = useState("");
  const [plans, setPlans] = useState<PlanHistoryItem[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationHistoryItem[]>([]);
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
  const [trainingRows, setTrainingRows] = useState<TrainingDataItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(getStoredToken());
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError("");
    try {
      const [p, r, s, t] = await Promise.all([
        getPlanHistory(token),
        getRecommendationHistory(token),
        getSessionHistory(token),
        getTrainingData(token),
      ]);
      setPlans(p.items);
      setRecommendations(r.items);
      setSessions(s.items);
      setTrainingRows(t.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void refresh();
  }, [token, refresh]);

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
    const courseCounts = sessions.reduce<Record<string, number>>((acc, item) => {
      acc[item.course_name] = (acc[item.course_name] ?? 0) + 1;
      return acc;
    }, {});
    let topCourse = "-";
    let topCourseSessions = 0;
    Object.entries(courseCounts).forEach(([course, count]) => {
      if (count > topCourseSessions) {
        topCourse = course;
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
    token,
    plans,
    recommendations,
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
// Tab navigation for /progress sub-routes
// ---------------------------------------------------------------------------

const tabs = [
  { href: "/progress", label: "Overview", icon: LineChart },
  { href: "/progress/log", label: "Log Session", icon: ClipboardCheck },
  { href: "/progress/predict", label: "Predictor", icon: Sparkles },
  { href: "/progress/history", label: "History", icon: History },
] as const;

export function ProgressTabNav() {
  const pathname = usePathname();
  return (
    <nav className="tab-nav animate-in" aria-label="Progress tabs">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/progress" ? pathname === "/progress" : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={`tab-link ${active ? "active" : ""}`}>
            <Icon size={15} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
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
