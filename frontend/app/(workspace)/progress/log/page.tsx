"use client";

import { FormEvent, useState } from "react";
import { BarChart3, Send, Target } from "lucide-react";

import { logSession, type SessionLogResponse } from "@/lib/api";
import { useProgress, clampPercent } from "../_lib/shared";

export default function ProgressLogPage() {
  const { token, sessions, refresh } = useProgress();
  const [courseName, setCourseName] = useState("CSC 401");
  const [plannedMinutes, setPlannedMinutes] = useState(120);
  const [actualMinutes, setActualMinutes] = useState(90);
  const [focusScore, setFocusScore] = useState(0.6);
  const [completionRate, setCompletionRate] = useState(0.7);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SessionLogResponse | null>(null);

  if (!token) {
    return (
      <div className="notice info">
        You are not signed in. Visit Authentication to log in first.
      </div>
    );
  }

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
        token,
      );
      setResult(response);
      setStatus("Session logged");
      await refresh();
    } catch (err) {
      setStatus("Log failed");
      setError((err as Error).message);
    }
  };

  const adherencePct = result ? clampPercent(result.computed.adherence) : 0;
  const predictedPct = result ? clampPercent(result.computed.predicted_adherence) : 0;

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="hero animate-in">
        <span className="kicker">
          <BarChart3 size={12} /> Log Session
        </span>
        <h2>Capture What Just Happened</h2>
        <p>
          Log the outcome of a study session. Your numbers feed the adherence model, refine
          recommendations, and show up immediately in the overview tab.
        </p>
        <p className="muted-text" style={{ marginTop: 8 }}>
          {sessions.length} sessions logged so far.
        </p>
      </section>

      <section className="grid two stagger">
        <article className="card">
          <h3>
            <Send size={16} /> Session Details
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

        <article className="card">
          <h3>
            <Target size={16} /> What the Numbers Mean
          </h3>
          <ul style={{ paddingLeft: 18 }}>
            <li>
              <strong>Adherence</strong> = actual / planned minutes, capped at 1.
            </li>
            <li>
              <strong>Focus score</strong> reflects perceived concentration during the session.
            </li>
            <li>
              <strong>Completion rate</strong> reflects how much of the planned material was covered.
            </li>
            <li>
              <strong>Predicted adherence</strong> is the model&apos;s estimate based on your rolling
              behaviour; it gets stored alongside the actual adherence for later comparison.
            </li>
          </ul>
        </article>
      </section>

      {result && (
        <section className="grid four stagger">
          <article className="stat">
            <span className="stat-label">
              <Target size={14} /> Adherence
            </span>
            <p className="stat-value">{adherencePct.toFixed(0)}%</p>
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${adherencePct}%` }} />
            </div>
          </article>

          <article className="forecast-card stat">
            <span className="stat-label">Predicted</span>
            <p className="stat-value">{predictedPct.toFixed(0)}%</p>
            <p className="stat-meta">Model: {result.computed.model_version}</p>
          </article>

          <article className="stat">
            <span className="stat-label">Focus signal</span>
            <p className="stat-value">{(result.computed.focus_score * 100).toFixed(0)}%</p>
          </article>

          <article className="stat">
            <span className="stat-label">Completion signal</span>
            <p className="stat-value">{(result.computed.completion_rate * 100).toFixed(0)}%</p>
          </article>
        </section>
      )}
    </div>
  );
}
