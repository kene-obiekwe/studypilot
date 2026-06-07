"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, History, ListChecks, Sparkles } from "lucide-react";

import { clampPercent, formatDate, useProgress } from "../_lib/shared";

const PAGE_SIZE = 6;

export default function ProgressHistoryPage() {
  const { token, plans, recommendations, sessions } = useProgress();
  const [planPage, setPlanPage] = useState(1);
  const [recPage, setRecPage] = useState(1);
  const [sessionPage, setSessionPage] = useState(1);

  const planTotal = Math.max(1, Math.ceil(plans.length / PAGE_SIZE));
  const recTotal = Math.max(1, Math.ceil(recommendations.length / PAGE_SIZE));
  const sessionTotal = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));

  useEffect(() => {
    setPlanPage((prev) => Math.min(prev, planTotal));
  }, [planTotal]);
  useEffect(() => {
    setRecPage((prev) => Math.min(prev, recTotal));
  }, [recTotal]);
  useEffect(() => {
    setSessionPage((prev) => Math.min(prev, sessionTotal));
  }, [sessionTotal]);

  const pagedPlans = useMemo(
    () => plans.slice((planPage - 1) * PAGE_SIZE, planPage * PAGE_SIZE),
    [plans, planPage],
  );
  const pagedRecs = useMemo(
    () => recommendations.slice((recPage - 1) * PAGE_SIZE, recPage * PAGE_SIZE),
    [recommendations, recPage],
  );
  const pagedSessions = useMemo(
    () => sessions.slice((sessionPage - 1) * PAGE_SIZE, sessionPage * PAGE_SIZE),
    [sessions, sessionPage],
  );

  if (!token) {
    return (
      <div className="notice info">
        You are not signed in. Visit Authentication to log in first.
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="hero animate-in">
        <span className="kicker">
          <History size={12} /> History
        </span>
        <h2>Your Complete Archive</h2>
        <p>
          Paginated, ordered most-recent first. Every plan, recommendation, and session you have logged
          shows up here.
        </p>
        <div className="pill-row">
          <span className="pill">{plans.length} plans</span>
          <span className="pill">{recommendations.length} recommendations</span>
          <span className="pill accent">{sessions.length} sessions</span>
        </div>
      </section>

      <article className="card">
        <div className="section-head">
          <h3>
            <ListChecks size={16} /> All Planner Plans
          </h3>
          <span className="muted-text">
            Page {planPage} of {planTotal}
          </span>
        </div>
        {plans.length === 0 ? (
          <p>No plans yet.</p>
        ) : (
          <div className="grid" style={{ gap: 10, marginTop: 12 }}>
            {pagedPlans.map((plan) => {
              const allocations = plan.plan_json.allocations ?? [];
              return (
                <div key={plan.id} className="history-row">
                  <div className="row-head">
                    <span>Plan #{plan.id}</span>
                    <span className="pill">{plan.plan_json.total_available_hours ?? "-"}h total</span>
                  </div>
                  <div className="row-meta">
                    {formatDate(plan.created_at)} · {(plan.plan_json.courses ?? []).length} courses
                  </div>
                  {allocations.length > 0 && (
                    <div className="pill-row">
                      {allocations.slice(0, 4).map((a) => (
                        <span className="pill" key={`${plan.id}-${a.course}`}>
                          {a.course}: {a.allocated_hours}h
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {plans.length > PAGE_SIZE && (
          <Pager page={planPage} total={planTotal} onChange={setPlanPage} />
        )}
      </article>

      <article className="card">
        <div className="section-head">
          <h3>
            <Sparkles size={16} /> All Recommendation Events
          </h3>
          <span className="muted-text">
            Page {recPage} of {recTotal}
          </span>
        </div>
        {recommendations.length === 0 ? (
          <p>No recommendations yet.</p>
        ) : (
          <div className="grid" style={{ gap: 10, marginTop: 12 }}>
            {pagedRecs.map((rec) => (
              <div key={rec.id} className="history-row">
                <div className="row-head">
                  <span>{rec.preferred_style}</span>
                  <span className="pill accent">{(rec.confidence * 100).toFixed(0)}% confidence</span>
                </div>
                <div className="row-meta">
                  {formatDate(rec.created_at)} · focus {(rec.focus_score * 100).toFixed(0)}% · completion{" "}
                  {(rec.completion_rate * 100).toFixed(0)}%
                </div>
                {rec.strategies_json.length > 0 && (
                  <div className="pill-row">
                    {rec.strategies_json.slice(0, 3).map((s) => (
                      <span className="pill" key={`${rec.id}-${s}`}>
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {recommendations.length > PAGE_SIZE && (
          <Pager page={recPage} total={recTotal} onChange={setRecPage} />
        )}
      </article>

      <article className="card">
        <div className="section-head">
          <h3>
            <BarChart3 size={16} /> All Session Logs
          </h3>
          <span className="muted-text">
            Page {sessionPage} of {sessionTotal}
          </span>
        </div>
        {sessions.length === 0 ? (
          <p>No sessions yet.</p>
        ) : (
          <div className="grid" style={{ gap: 10, marginTop: 12 }}>
            {pagedSessions.map((item) => {
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
                    {formatDate(item.created_at)} · adherence {adherencePct.toFixed(0)}%
                    {predictedPct !== null ? ` · predicted ${predictedPct.toFixed(0)}%` : ""}
                    {item.model_version ? ` · ${item.model_version}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {sessions.length > PAGE_SIZE && (
          <Pager page={sessionPage} total={sessionTotal} onChange={setSessionPage} />
        )}
      </article>
    </div>
  );
}

function Pager({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        Page {page} of {total}
      </span>
      <div className="pager-controls">
        <button
          type="button"
          className="secondary"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          Previous
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => onChange(Math.min(total, page + 1))}
          disabled={page === total}
        >
          Next
        </button>
      </div>
    </div>
  );
}
