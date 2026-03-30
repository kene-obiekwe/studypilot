"use client";

import { FormEvent, useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { getStoredToken } from "@/lib/session";
import { logSession, type SessionLogResponse } from "@/lib/api";

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

  useEffect(() => {
    setToken(getStoredToken());
  }, []);

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
    } catch (err) {
      setStatus("Log failed");
      setError((err as Error).message);
    }
  };

  const adherencePercent = result ? Math.max(0, Math.min(100, result.computed.adherence * 100)) : 0;

  return (
    <div className="grid" style={{ gap: 14 }}>
      <section className="hero">
        <span className="kicker">Step 4</span>
        <h2>Progress and Reflective Tracking</h2>
        <p>Log your study outcomes and track adherence as a signal for future timetable optimisation.</p>
      </section>

      {!token && <div className="notice">You are not signed in. Visit Authentication to log in first.</div>}

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
