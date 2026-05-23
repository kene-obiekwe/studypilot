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
  predictAdherence,
  type AdherencePredictionResponse,
  type PlanHistoryItem,
  type RecommendationHistoryItem,
  type SessionHistoryItem,
  type SessionLogResponse,
  type TrainingDataItem,
} from "@/lib/api";

export default function ProgressPage() {
  const formatDate = (value: string) => new Date(value).toLocaleString();
  const [token, setToken] = useState("");
  const [courseName, setCourseName] = useState("CSC 401");
  const [plannedMinutes, setPlannedMinutes] = useState(120);
  const [actualMinutes, setActualMinutes] = useState(90);
  const [focusScore, setFocusScore] = useState(0.6);
  const [completionRate, setCompletionRate] = useState(0.7);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SessionLogResponse | null>(null);
  const [predictPlannedMinutes, setPredictPlannedMinutes] = useState(120);
  const [predictActualMinutes, setPredictActualMinutes] = useState(90);
  const [predictFocusScore, setPredictFocusScore] = useState(0.6);
  const [predictCompletionRate, setPredictCompletionRate] = useState(0.7);
  const [predictHelpSeekingRate, setPredictHelpSeekingRate] = useState<number | "">("");
  const [predictAvgQuizScore, setPredictAvgQuizScore] = useState<number | "">("");
  const [predictStatus, setPredictStatus] = useState("Ready");
  const [predictError, setPredictError] = useState("");
  const [predictResult, setPredictResult] = useState<AdherencePredictionResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [plannerCount, setPlannerCount] = useState(0);
  const [recommendationCount, setRecommendationCount] = useState(0);
  const [planHistory, setPlanHistory] = useState<PlanHistoryItem[]>([]);
  const [recommendationHistory, setRecommendationHistory] = useState<RecommendationHistoryItem[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryItem[]>([]);
  const [trainingRows, setTrainingRows] = useState<TrainingDataItem[]>([]);
  const [planPage, setPlanPage] = useState(1);
  const [recommendationPage, setRecommendationPage] = useState(1);
  const [sessionPage, setSessionPage] = useState(1);

  const planPageSize = 4;
  const recommendationPageSize = 4;
  const sessionPageSize = 8;

  useEffect(() => {
    setToken(getStoredToken());
  }, []);

  useEffect(() => {
    if (!token) {
      setPlannerCount(0);
      setRecommendationCount(0);
      setPlanHistory([]);
      setRecommendationHistory([]);
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
      setPlanHistory(plans.items);
      setRecommendationHistory(recommendations.items);
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

  const onPredict = async (event: FormEvent) => {
    event.preventDefault();
    setPredictError("");
    setPredictStatus("Generating forecast...");

    try {
      const response = await predictAdherence(
        {
          planned_minutes: predictPlannedMinutes,
          actual_minutes_estimate: predictActualMinutes,
          focus_score: predictFocusScore,
          completion_rate: predictCompletionRate,
          help_seeking_rate: predictHelpSeekingRate === "" ? null : Number(predictHelpSeekingRate),
          avg_quiz_score_recent: predictAvgQuizScore === "" ? null : Number(predictAvgQuizScore),
        },
        token
      );

      setPredictResult(response);
      setPredictStatus("Forecast ready");
    } catch (err) {
      setPredictStatus("Forecast failed");
      setPredictError((err as Error).message);
    }
  };

  const adherencePercent = result ? Math.max(0, Math.min(100, result.computed.adherence * 100)) : 0;
  const predictedPercent = result
    ? Math.max(0, Math.min(100, result.computed.predicted_adherence * 100))
    : 0;
  const forecastPercent = predictResult
    ? Math.max(0, Math.min(100, predictResult.predicted_adherence * 100))
    : 0;

  const analytics = useMemo(() => {
    if (sessionHistory.length === 0) {
      return {
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
      };
    }

    const totals = sessionHistory.reduce(
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
      { adherence: 0, predicted: 0, predictedCount: 0, focus: 0, completion: 0, planned: 0, actual: 0 }
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

    const latestModelVersion =
      sessionHistory.find((item) => item.model_version && item.model_version.length > 0)?.model_version ?? "-";

    return {
      avgAdherence: totals.adherence / sessionHistory.length,
      avgPredicted: totals.predictedCount > 0 ? totals.predicted / totals.predictedCount : 0,
      avgFocus: totals.focus / sessionHistory.length,
      avgCompletion: totals.completion / sessionHistory.length,
      totalPlannedMinutes: totals.planned,
      totalActualMinutes: totals.actual,
      topCourse,
      topCourseSessions,
      weeklyIntensity,
      latestModelVersion,
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
  const latestPlans = planHistory.slice(0, 3);
  const latestRecommendations = recommendationHistory.slice(0, 3);

  const planTotalPages = Math.max(1, Math.ceil(planHistory.length / planPageSize));
  const recommendationTotalPages = Math.max(1, Math.ceil(recommendationHistory.length / recommendationPageSize));
  const sessionTotalPages = Math.max(1, Math.ceil(sessionHistory.length / sessionPageSize));

  useEffect(() => {
    setPlanPage((prev) => (prev > planTotalPages ? planTotalPages : prev));
  }, [planTotalPages]);

  useEffect(() => {
    setRecommendationPage((prev) => (prev > recommendationTotalPages ? recommendationTotalPages : prev));
  }, [recommendationTotalPages]);

  useEffect(() => {
    setSessionPage((prev) => (prev > sessionTotalPages ? sessionTotalPages : prev));
  }, [sessionTotalPages]);

  const pagedPlans = planHistory.slice((planPage - 1) * planPageSize, planPage * planPageSize);
  const pagedRecommendations = recommendationHistory.slice(
    (recommendationPage - 1) * recommendationPageSize,
    recommendationPage * recommendationPageSize
  );
  const pagedSessions = sessionHistory.slice((sessionPage - 1) * sessionPageSize, sessionPage * sessionPageSize);

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
        <section className="grid four stagger">
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
              <Sparkles size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} /> AI Forecast (Avg)
            </h3>
            <p>{(analytics.avgPredicted * 100).toFixed(0)}%</p>
            <small>Model: {analytics.latestModelVersion}</small>
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
            <div className="section-head">
              <h3>Training Dataset Snapshot</h3>
            </div>
            <div className="pill-row" style={{ marginTop: 10 }}>
              <span className="pill">Rows: {trainingRows.length}</span>
              <span className="pill">Avg sessions/7d: {analytics.weeklyIntensity.toFixed(1)}</span>
              <span className="pill">Difficulty L/M/H: {difficultyMix.low}/{difficultyMix.medium}/{difficultyMix.high}</span>
            </div>
          </article>

          <article className="card">
            <div className="section-head">
              <h3>Latest Session Logs</h3>
              <a className="text-link" href="#all-sessions">View all</a>
            </div>
            {recentSessions.length === 0 && <p>No session history yet. Submit a log to begin.</p>}
            {recentSessions.length > 0 && (
              <div className="grid" style={{ gap: 8 }}>
                {recentSessions.map((item) => {
                  const itemAdherencePercent = Math.max(0, Math.min(100, item.adherence_score * 100));
                  const itemPredictedPercent =
                    typeof item.predicted_adherence === "number"
                      ? Math.max(0, Math.min(100, item.predicted_adherence * 100))
                      : null;
                  return (
                    <div key={item.id} className="notice" style={{ marginTop: 0 }}>
                      <strong>{item.course_name}</strong> {item.actual_minutes}/{item.planned_minutes} mins | adherence {itemAdherencePercent.toFixed(0)}%
                      {itemPredictedPercent !== null ? ` | predicted ${itemPredictedPercent.toFixed(0)}%` : ""}
                      {item.model_version ? ` | ${item.model_version}` : ""}
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </section>
      )}

      {token && (
        <section className="grid two">
          <article className="card">
            <div className="section-head">
              <h3>Latest Planner Plans</h3>
              <a className="text-link" href="#all-plans">View all</a>
            </div>
            {latestPlans.length === 0 && <p>No plans generated yet. Create one in the Planner tab.</p>}
            {latestPlans.length > 0 && (
              <div className="grid" style={{ gap: 8 }}>
                {latestPlans.map((plan) => {
                  const courses = plan.plan_json.courses ?? [];
                  const allocations = plan.plan_json.allocations ?? [];
                  const totalHours = plan.plan_json.total_available_hours ?? "-";

                  return (
                    <div key={plan.id} className="notice" style={{ marginTop: 0 }}>
                      <strong>Plan {plan.id}</strong> | {formatDate(plan.created_at)}
                      <br />
                      <small>
                        Total hours: {totalHours} | Courses: {courses.length}
                        {allocations.length > 0
                          ? ` | Top: ${allocations
                              .slice(0, 2)
                              .map((item) => `${item.course} ${item.allocated_hours}h`)
                              .join(", ")}`
                          : ""}
                      </small>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          <article className="card">
            <div className="section-head">
              <h3>Latest Recommendation Events</h3>
              <a className="text-link" href="#all-recommendations">View all</a>
            </div>
            {latestRecommendations.length === 0 && <p>No recommendations yet. Generate them in the Recommendations tab.</p>}
            {latestRecommendations.length > 0 && (
              <div className="grid" style={{ gap: 8 }}>
                {latestRecommendations.map((rec) => (
                  <div key={rec.id} className="notice" style={{ marginTop: 0 }}>
                    <strong>{rec.preferred_style}</strong> | {formatDate(rec.created_at)}
                    <br />
                    <small>
                      Focus: {(rec.focus_score * 100).toFixed(0)}% | Completion: {(rec.completion_rate * 100).toFixed(0)}%
                    </small>
                    <div style={{ marginTop: 6 }}>
                      {rec.strategies_json.map((item) => (
                        <span key={item} className="pill" style={{ marginRight: 6, marginBottom: 6 }}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      )}

      {token && (
        <section className="grid two" id="all-plans" style={{ scrollMarginTop: 80 }}>
          <article className="card">
            <h3>All Planner Plans</h3>
            {planHistory.length === 0 && <p>No plans generated yet.</p>}
            {planHistory.length > 0 && (
              <div className="grid" style={{ gap: 8 }}>
                {pagedPlans.map((plan) => {
                  const courses = plan.plan_json.courses ?? [];
                  const allocations = plan.plan_json.allocations ?? [];
                  const totalHours = plan.plan_json.total_available_hours ?? "-";

                  return (
                    <div key={plan.id} className="notice" style={{ marginTop: 0 }}>
                      <strong>Plan {plan.id}</strong> | {formatDate(plan.created_at)}
                      <br />
                      <small>
                        Total hours: {totalHours} | Courses: {courses.length}
                        {allocations.length > 0
                          ? ` | Top: ${allocations
                              .slice(0, 2)
                              .map((item) => `${item.course} ${item.allocated_hours}h`)
                              .join(", ")}`
                          : ""}
                      </small>
                    </div>
                  );
                })}
              </div>
            )}

            {planHistory.length > planPageSize && (
              <div className="pager">
                <span>
                  Page {planPage} of {planTotalPages}
                </span>
                <div className="pager-controls">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setPlanPage((prev) => Math.max(1, prev - 1))}
                    disabled={planPage === 1}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setPlanPage((prev) => Math.min(planTotalPages, prev + 1))}
                    disabled={planPage === planTotalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </article>

          <article className="card" id="all-recommendations" style={{ scrollMarginTop: 80 }}>
            <h3>All Recommendation Events</h3>
            {recommendationHistory.length === 0 && <p>No recommendations yet.</p>}
            {recommendationHistory.length > 0 && (
              <div className="grid" style={{ gap: 8 }}>
                {pagedRecommendations.map((rec) => (
                  <div key={rec.id} className="notice" style={{ marginTop: 0 }}>
                    <strong>{rec.preferred_style}</strong> | {formatDate(rec.created_at)}
                    <br />
                    <small>
                      Focus: {(rec.focus_score * 100).toFixed(0)}% | Completion: {(rec.completion_rate * 100).toFixed(0)}%
                    </small>
                    <div style={{ marginTop: 6 }}>
                      {rec.strategies_json.map((item) => (
                        <span key={item} className="pill" style={{ marginRight: 6, marginBottom: 6 }}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {recommendationHistory.length > recommendationPageSize && (
              <div className="pager">
                <span>
                  Page {recommendationPage} of {recommendationTotalPages}
                </span>
                <div className="pager-controls">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setRecommendationPage((prev) => Math.max(1, prev - 1))}
                    disabled={recommendationPage === 1}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setRecommendationPage((prev) => Math.min(recommendationTotalPages, prev + 1))}
                    disabled={recommendationPage === recommendationTotalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </article>
        </section>
      )}

      {token && (
        <section className="grid" id="all-sessions" style={{ scrollMarginTop: 80 }}>
          <article className="card">
            <h3>All Session Logs</h3>
            {sessionHistory.length === 0 && <p>No session history yet.</p>}
            {sessionHistory.length > 0 && (
              <div className="grid" style={{ gap: 8 }}>
                {pagedSessions.map((item) => {
                  const itemAdherencePercent = Math.max(0, Math.min(100, item.adherence_score * 100));
                  const itemPredictedPercent =
                    typeof item.predicted_adherence === "number"
                      ? Math.max(0, Math.min(100, item.predicted_adherence * 100))
                      : null;
                  return (
                    <div key={item.id} className="notice" style={{ marginTop: 0 }}>
                      <strong>{item.course_name}</strong> | {formatDate(item.created_at)}
                      <br />
                      <small>
                        {item.actual_minutes}/{item.planned_minutes} mins | adherence {itemAdherencePercent.toFixed(0)}%
                        {itemPredictedPercent !== null ? ` | predicted ${itemPredictedPercent.toFixed(0)}%` : ""}
                        {item.model_version ? ` | ${item.model_version}` : ""}
                      </small>
                    </div>
                  );
                })}
              </div>
            )}

            {sessionHistory.length > sessionPageSize && (
              <div className="pager">
                <span>
                  Page {sessionPage} of {sessionTotalPages}
                </span>
                <div className="pager-controls">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSessionPage((prev) => Math.max(1, prev - 1))}
                    disabled={sessionPage === 1}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSessionPage((prev) => Math.min(sessionTotalPages, prev + 1))}
                    disabled={sessionPage === sessionTotalPages}
                  >
                    Next
                  </button>
                </div>
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

      <section className="grid two">
        <article className="card">
          <h3>
            <Sparkles size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} /> Adherence Predictor
          </h3>

          <form className="form-grid" onSubmit={onPredict}>
            <label>
              Planned minutes
              <input
                type="number"
                min={1}
                value={predictPlannedMinutes}
                onChange={(e) => setPredictPlannedMinutes(Number(e.target.value))}
              />
            </label>
            <label>
              Actual minutes estimate
              <input
                type="number"
                min={0}
                value={predictActualMinutes}
                onChange={(e) => setPredictActualMinutes(Number(e.target.value))}
              />
            </label>
            <label>
              Focus score (0 to 1)
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={predictFocusScore}
                onChange={(e) => setPredictFocusScore(Number(e.target.value))}
              />
            </label>
            <label>
              Completion rate (0 to 1)
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={predictCompletionRate}
                onChange={(e) => setPredictCompletionRate(Number(e.target.value))}
              />
            </label>
            <label>
              Help-seeking rate (optional)
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={predictHelpSeekingRate}
                onChange={(e) =>
                  setPredictHelpSeekingRate(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </label>
            <label>
              Avg quiz score recent (optional)
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={predictAvgQuizScore}
                onChange={(e) => setPredictAvgQuizScore(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>

            <button type="submit" disabled={!token}>
              Generate Forecast
            </button>
          </form>

          <div className="notice ok">Status: {predictStatus}</div>
          {predictError && <div className="notice error">{predictError}</div>}

          {predictResult && (
            <div className="result">
              <strong>Forecast:</strong> {forecastPercent.toFixed(0)}% adherence
              <br />
              <small>Model: {predictResult.model_version}</small>
            </div>
          )}
        </article>

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
      </section>

      {result && (
        <section className="grid four stagger">
          <article className="card">
            <h3>Adherence</h3>
            <p>{adherencePercent.toFixed(0)}%</p>
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${adherencePercent}%` }} />
            </div>
          </article>

          <article className="card">
            <h3>Predicted Adherence</h3>
            <p>{predictedPercent.toFixed(0)}%</p>
            <small>Model: {result.computed.model_version}</small>
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
