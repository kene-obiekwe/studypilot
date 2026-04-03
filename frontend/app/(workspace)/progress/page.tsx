"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BarChart3, BrainCircuit, Clock3, ListChecks, Sparkles, Target } from "lucide-react";
import { getStoredToken } from "@/lib/session";
import {
  getPlanHistory,
  getRecommendationHistory,
  getSessionHistory,
  getTrainingData,
  logSession,
  type SessionHistoryItem,
  type SessionLogResponse,
  type TrainingDataItem,
} from "@/lib/api";

export default function ProgressPage() {
  const [token, setToken] = useState("");
  const [courseName, setCourseName] = useState("CSC 401");
  const [plannedMinutes, setPlannedMinutes] = useState(120);
  const [actualMinutes, setActualMinutes] = useState(90);
  const [focusScore, setFocusScore] = useState(0.6);
  const [completionRate, setCompletionRate] = useState(0.7);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SessionLogResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [plannerCount, setPlannerCount] = useState(0);
  const [recommendationCount, setRecommendationCount] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryItem[]>([]);
  const [trainingRows, setTrainingRows] = useState<TrainingDataItem[]>([]);

  useEffect(() => {
    setToken(getStoredToken());
  }, []);

  useEffect(() => {
    if (!token) {
      setPlannerCount(0);
      setRecommendationCount(0);
      setSessionHistory([]);
      setTrainingRows([]);
      return;
    }

    void refreshAnalytics(token);
  }, [token]);

  const refreshAnalytics = async (activeToken: string) => {
    setIsRefreshing(true);
    setRefreshError("");
    try {
      const [plans, recommendations, sessions, training] = await Promise.all([
        getPlanHistory(activeToken),
        getRecommendationHistory(activeToken),
        getSessionHistory(activeToken),
        getTrainingData(activeToken),
      ]);

      setPlannerCount(plans.items.length);
      setRecommendationCount(recommendations.items.length);
      setSessionHistory(sessions.items);
      setTrainingRows(training.rows);
    } catch (err) {
      setRefreshError((err as Error).message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("Logging session...");

    try {
      const response = await logSession(
        {
          course_name: courseName,
          planned_minutes: plannedMinutes,
          actual_minutes: actualMinutes,
          focus_score: focusScore,
          completion_rate: completionRate,
        },
        token
      );

      setResult(response);
      setStatus("Session logged");
      await refreshAnalytics(token);
    } catch (err) {
      setStatus("Log failed");
      setError((err as Error).message);
    }
  };

  const adherencePercent = result ? Math.max(0, Math.min(100, result.computed.adherence * 100)) : 0;

  const analytics = useMemo(() => {
    if (sessionHistory.length === 0) {
      return {
        avgAdherence: 0,
        avgFocus: 0,
        avgCompletion: 0,
        totalPlannedMinutes: 0,
        totalActualMinutes: 0,
        topCourse: "-",
        topCourseSessions: 0,
        weeklyIntensity: 0,
      };
    }

    const totals = sessionHistory.reduce(
      (acc, item) => {
        acc.adherence += item.adherence_score;
        acc.focus += item.focus_score;
        acc.completion += item.completion_rate;
        acc.planned += item.planned_minutes;
        acc.actual += item.actual_minutes;
        return acc;
      },
      { adherence: 0, focus: 0, completion: 0, planned: 0, actual: 0 }
    );

    const courseCounts = sessionHistory.reduce<Record<string, number>>((acc, item) => {
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

    return {
      avgAdherence: totals.adherence / sessionHistory.length,
      avgFocus: totals.focus / sessionHistory.length,
      avgCompletion: totals.completion / sessionHistory.length,
      totalPlannedMinutes: totals.planned,
      totalActualMinutes: totals.actual,
      topCourse,
      topCourseSessions,
      weeklyIntensity,
    };
  }, [sessionHistory, trainingRows]);

  const difficultyMix = useMemo(() => {
    const buckets = { low: 0, medium: 0, high: 0 };

    trainingRows.forEach((row) => {
      if (row.difficulty <= 2) {
        buckets.low += 1;
      } else if (row.difficulty === 3) {
        buckets.medium += 1;
      } else {
        buckets.high += 1;
      }
    });

    return buckets;
  }, [trainingRows]);

  const recentSessions = sessionHistory.slice(0, 6);

  return (
    <div className="grid" style={{ gap: 14 }}>
      <section className="hero">
        <span className="kicker">Step 4</span>
        <h2>Progress and Reflective Tracking</h2>
        <p>Log outcomes and view real learning analytics generated from your persisted planner, recommendation, and tracking history.</p>
      </section>

      {!token && <div className="notice">You are not signed in. Visit Authentication to log in first.</div>}

      {token && (
        <section className="grid three stagger">
          <article className="card">
            <div className="card-icon">
              <ListChecks size={18} />
            </div>
            <h3>Planner Histories</h3>
            <p>{plannerCount}</p>
          </article>

          <article className="card">
            <div className="card-icon">
              <Sparkles size={18} />
            </div>
            <h3>Recommendation Events</h3>
            <p>{recommendationCount}</p>
          </article>

          <article className="card">
            <div className="card-icon">
              <BarChart3 size={18} />
            </div>
            <h3>Tracked Sessions</h3>
            <p>{sessionHistory.length}</p>
          </article>
        </section>
      )}

      {token && (
        <section className="grid three stagger">
          <article className="card">
            <h3>
              <Target size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} /> Average Adherence
            </h3>
            <p>{(analytics.avgAdherence * 100).toFixed(0)}%</p>
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${Math.max(0, Math.min(100, analytics.avgAdherence * 100))}%` }} />
            </div>
          </article>

          <article className="card">
            <h3>
              <BrainCircuit size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} /> Focus / Completion
            </h3>
            <p>
              {(analytics.avgFocus * 100).toFixed(0)}% / {(analytics.avgCompletion * 100).toFixed(0)}%
            </p>
            <small>Signals used by recommendation and adherence models.</small>
          </article>

          <article className="card">
            <h3>
              <Clock3 size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} /> Time Coverage
            </h3>
            <p>
              {analytics.totalActualMinutes} / {analytics.totalPlannedMinutes} mins
            </p>
            <small>
              Top course: {analytics.topCourse} ({analytics.topCourseSessions} sessions)
            </small>
          </article>
        </section>
      )}

      {token && (
        <section className="grid two">
          <article className="card">
            <h3>Training Dataset Snapshot</h3>
            <div className="pill-row" style={{ marginTop: 10 }}>
              <span className="pill">Rows: {trainingRows.length}</span>
              <span className="pill">Avg sessions/7d: {analytics.weeklyIntensity.toFixed(1)}</span>
              <span className="pill">Difficulty L/M/H: {difficultyMix.low}/{difficultyMix.medium}/{difficultyMix.high}</span>
            </div>
          </article>

          <article className="card">
            <h3>Latest Session Logs</h3>
            {recentSessions.length === 0 && <p>No session history yet. Submit a log to begin.</p>}
            {recentSessions.length > 0 && (
              <div className="grid" style={{ gap: 8 }}>
                {recentSessions.map((item) => {
                  const itemAdherencePercent = Math.max(0, Math.min(100, item.adherence_score * 100));
                  return (
                    <div key={item.id} className="notice" style={{ marginTop: 0 }}>
                      <strong>{item.course_name}</strong> {item.actual_minutes}/{item.planned_minutes} mins | adherence {itemAdherencePercent.toFixed(0)}%
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </section>
      )}

      {token && (
        <div className="notice ok">
          Data sync: {isRefreshing ? "Refreshing analytics..." : "Up to date"}
          {refreshError ? ` | Last refresh error: ${refreshError}` : ""}
        </div>
      )}

      <article className="card">
        <h3>
          <BarChart3 size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} /> Session Log Input
        </h3>

        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Course name
            <input value={courseName} onChange={(e) => setCourseName(e.target.value)} />
          </label>
          <label>
            Planned minutes
            <input
              type="number"
              min={1}
              value={plannedMinutes}
              onChange={(e) => setPlannedMinutes(Number(e.target.value))}
            />
          </label>
          <label>
            Actual minutes
            <input
              type="number"
              min={0}
              value={actualMinutes}
              onChange={(e) => setActualMinutes(Number(e.target.value))}
            />
          </label>
          <label>
            Focus score (0 to 1)
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={focusScore}
              onChange={(e) => setFocusScore(Number(e.target.value))}
            />
          </label>
          <label>
            Completion rate (0 to 1)
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={completionRate}
              onChange={(e) => setCompletionRate(Number(e.target.value))}
            />
          </label>

          <button type="submit" disabled={!token}>
            Submit Progress Log
          </button>
        </form>

        <div className="notice ok">Status: {status}</div>
        {error && <div className="notice error">{error}</div>}
      </article>

      {result && (
        <section className="grid three stagger">
          <article className="card">
            <h3>Adherence</h3>
            <p>{adherencePercent.toFixed(0)}%</p>
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${adherencePercent}%` }} />
            </div>
          </article>

          <article className="card">
            <h3>Focus Signal</h3>
            <p>{(result.computed.focus_score * 100).toFixed(0)}%</p>
          </article>

          <article className="card">
            <h3>Completion Signal</h3>
            <p>{(result.computed.completion_rate * 100).toFixed(0)}%</p>
          </article>
        </section>
      )}
    </div>
  );
}
