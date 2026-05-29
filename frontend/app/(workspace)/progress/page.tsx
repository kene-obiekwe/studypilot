"use client";

import {
  BarChart3,
  BrainCircuit,
  Clock3,
  ListChecks,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";

import { clampPercent, formatDate, useProgress } from "./_lib/shared";

export default function ProgressOverviewPage() {
  const { token, sessions, plans, recommendations, trainingRows, analytics, isLoading, error, refresh } =
    useProgress();

  if (!token) {
    return (
      <div className="notice info">
        You are not signed in. Visit Authentication to log in first.
      </div>
    );
  }

  const recentSessions = sessions.slice(0, 5);
  const latestPlan = plans[0];
  const latestRecommendation = recommendations[0];

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="hero animate-in">
        <span className="kicker">
          <Sparkles size={12} /> Step 4
        </span>
        <h2>Your Study Overview</h2>
        <p>
          Real-time analytics from your persisted planner, recommendation, and tracking history. Use the tabs
          above to log a session, run a forecast, or browse the full archive.
        </p>
        <div className="pill-row">
          <span className="pill">{sessions.length} sessions</span>
          <span className="pill">{plans.length} plans</span>
          <span className="pill">{recommendations.length} recommendation events</span>
          <span className="pill accent">Model: {analytics.latestModelVersion}</span>
        </div>
      </section>

      <section className="grid four stagger">
        <article className="stat">
          <span className="stat-label">
            <Target size={14} /> Average Adherence
          </span>
          <p className="stat-value">{(analytics.avgAdherence * 100).toFixed(0)}%</p>
          <div className="progress-wrap">
            <div className="progress-bar" style={{ width: `${clampPercent(analytics.avgAdherence)}%` }} />
          </div>
          <p className="stat-meta">Across {sessions.length} logged sessions</p>
        </article>

        <article className="forecast-card stat">
          <span className="stat-label">
            <Sparkles size={14} /> AI Forecast (Avg)
          </span>
          <p className="stat-value">{(analytics.avgPredicted * 100).toFixed(0)}%</p>
          <p className="stat-meta">Model: {analytics.latestModelVersion}</p>
        </article>

        <article className="stat">
          <span className="stat-label">
            <BrainCircuit size={14} /> Focus / Completion
          </span>
          <p className="stat-value">
            {(analytics.avgFocus * 100).toFixed(0)}% / {(analytics.avgCompletion * 100).toFixed(0)}%
          </p>
          <p className="stat-meta">Signals consumed by the model</p>
        </article>

        <article className="stat">
          <span className="stat-label">
            <Clock3 size={14} /> Time Coverage
          </span>
          <p className="stat-value">
            {analytics.totalActualMinutes} / {analytics.totalPlannedMinutes}
          </p>
          <p className="stat-meta">
            mins actual / planned
          </p>
        </article>
      </section>

      <section className="grid two stagger">
        <article className="card">
          <h3>
            <Trophy size={16} /> Course Spotlight
          </h3>
          <p>
            <strong>{analytics.topCourse}</strong> leads with {analytics.topCourseSessions} session
            {analytics.topCourseSessions === 1 ? "" : "s"} logged.
          </p>
          <div className="pill-row">
            <span className="pill">Weekly intensity: {analytics.weeklyIntensity.toFixed(1)} sessions/7d</span>
            <span className="pill success">Low {analytics.difficultyMix.low}</span>
            <span className="pill">Med {analytics.difficultyMix.medium}</span>
            <span className="pill warning">High {analytics.difficultyMix.high}</span>
          </div>
          <p style={{ marginTop: 12 }} className="muted-text">
            Difficulty mix is taken from the training-data snapshot ({trainingRows.length} rows).
          </p>
        </article>

        <article className="card">
          <h3>
            <ListChecks size={16} /> Latest Planner Plan
          </h3>
          {latestPlan ? (
            <>
              <p>
                <strong>Plan #{latestPlan.id}</strong> — {formatDate(latestPlan.created_at)}
              </p>
              <p className="muted-text">
                Total hours: {latestPlan.plan_json.total_available_hours ?? "-"} · Courses:{" "}
                {(latestPlan.plan_json.courses ?? []).length}
              </p>
              {latestPlan.plan_json.allocations && latestPlan.plan_json.allocations.length > 0 && (
                <div className="pill-row">
                  {latestPlan.plan_json.allocations.slice(0, 3).map((alloc) => (
                    <span className="pill" key={alloc.course}>
                      {alloc.course}: {alloc.allocated_hours}h
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p>No plans yet. Generate one in the Study Planner tab.</p>
          )}
        </article>
      </section>

      <section className="grid two stagger">
        <article className="card">
          <div className="section-head">
            <h3>
              <BarChart3 size={16} /> Recent Sessions
            </h3>
            <a className="text-link" href="/progress/history">
              View all
            </a>
          </div>
          {recentSessions.length === 0 ? (
            <p>No session history yet. Use Log Session to add one.</p>
          ) : (
            <div className="grid" style={{ gap: 10, marginTop: 12 }}>
              {recentSessions.map((item) => {
                const adherencePct = clampPercent(item.adherence_score);
                const predictedPct =
                  typeof item.predicted_adherence === "number"
                    ? clampPercent(item.predicted_adherence)
                    : null;
                return (
                  <div key={item.id} className="history-row">
                    <div className="row-head">
                      <span>{item.course_name}</span>
                      <span className="pill">
                        {item.actual_minutes}/{item.planned_minutes}m
                      </span>
                    </div>
                    <div className="row-meta">
                      adherence {adherencePct.toFixed(0)}%
                      {predictedPct !== null ? ` · predicted ${predictedPct.toFixed(0)}%` : ""}
                      {item.model_version ? ` · ${item.model_version}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <h3>
              <Sparkles size={16} /> Latest Recommendation
            </h3>
            <a className="text-link" href="/progress/history">
              View all
            </a>
          </div>
          {latestRecommendation ? (
            <>
              <p>
                <strong>{latestRecommendation.preferred_style}</strong> ·{" "}
                {formatDate(latestRecommendation.created_at)}
              </p>
              <p className="muted-text">
                Focus {(latestRecommendation.focus_score * 100).toFixed(0)}% · Completion{" "}
                {(latestRecommendation.completion_rate * 100).toFixed(0)}% · Confidence{" "}
                {(latestRecommendation.confidence * 100).toFixed(0)}%
              </p>
              <ul className="strategy-list">
                {latestRecommendation.strategies_json.slice(0, 3).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>No recommendations yet. Run one in the Recommendations tab.</p>
          )}
        </article>
      </section>

      <div className="notice ok">
        Data sync: {isLoading ? "refreshing analytics..." : "up to date"}
        {error ? ` · last error: ${error}` : ""}
        <button
          type="button"
          className="ghost"
          style={{ marginLeft: "auto", width: "auto" }}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
