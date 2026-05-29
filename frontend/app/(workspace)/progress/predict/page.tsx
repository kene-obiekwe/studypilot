"use client";

import { FormEvent, useState } from "react";
import { Activity, Compass, Sparkles } from "lucide-react";

import { predictAdherence, type AdherencePredictionResponse } from "@/lib/api";
import { clampPercent, useProgress } from "../_lib/shared";

export default function ProgressPredictPage() {
  const { token } = useProgress();
  const [plannedMinutes, setPlannedMinutes] = useState(120);
  const [focusScore, setFocusScore] = useState(0.6);
  const [completionRate, setCompletionRate] = useState(0.7);
  const [helpSeeking, setHelpSeeking] = useState<number | "">("");
  const [avgQuiz, setAvgQuiz] = useState<number | "">("");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AdherencePredictionResponse | null>(null);

  if (!token) {
    return (
      <div className="notice info">
        You are not signed in. Visit Authentication to log in first.
      </div>
    );
  }

  const onPredict = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("Generating forecast...");
    try {
      const response = await predictAdherence(
        {
          planned_minutes: plannedMinutes,
          focus_score: focusScore,
          completion_rate: completionRate,
          help_seeking_rate: helpSeeking === "" ? null : Number(helpSeeking),
          avg_quiz_score_recent: avgQuiz === "" ? null : Number(avgQuiz),
        },
        token,
      );
      setResult(response);
      setStatus("Forecast ready");
    } catch (err) {
      setStatus("Forecast failed");
      setError((err as Error).message);
    }
  };

  const forecastPct = result ? clampPercent(result.predicted_adherence) : 0;

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="hero animate-in">
        <span className="kicker">
          <Sparkles size={12} /> Predictor
        </span>
        <h2>Forecast Adherence Before You Start</h2>
        <p>
          Give the model the same signals it sees at session-time — planned minutes, focus, completion,
          optional help-seeking and quiz-score signals — and it returns a forecast you can use to calibrate
          your plan.
        </p>
      </section>

      <section className="grid two stagger">
        <article className="card">
          <h3>
            <Compass size={16} /> Forecast Inputs
          </h3>
          <form className="form-grid" onSubmit={onPredict}>
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
            <label>
              Help-seeking rate (optional)
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={helpSeeking}
                onChange={(e) => setHelpSeeking(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>
            <label>
              Avg quiz score recent (optional)
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={avgQuiz}
                onChange={(e) => setAvgQuiz(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>
            <button type="submit">Generate Forecast</button>
          </form>

          <div className="notice ok">Status: {status}</div>
          {error && <div className="notice error">{error}</div>}
        </article>

        {result ? (
          <article className="forecast-card animate-in">
            <span className="stat-label">
              <Activity size={14} /> Predicted Adherence
            </span>
            <p className="stat-value">{forecastPct.toFixed(0)}%</p>
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${forecastPct}%` }} />
            </div>
            <p className="stat-meta" style={{ marginTop: 12 }}>
              Model version: {result.model_version}
            </p>
            <hr className="divider" />
            <div className="pill-row">
              <span className="pill">{result.inputs.sessions_last_7_days} sessions / 7d</span>
              <span className="pill">consistency {(result.inputs.consistency_score * 100).toFixed(0)}%</span>
              <span className="pill accent">{result.inputs.planned_minutes} planned mins</span>
            </div>
          </article>
        ) : (
          <article className="card">
            <h3>
              <Activity size={16} /> What You Get
            </h3>
            <p>
              The forecast is a number in [0, 1] representing the proportion of planned minutes the model
              expects you to actually complete. Use it to calibrate session length: if the forecast is low,
              shorten the planned block or schedule a break before starting.
            </p>
            <p className="muted-text">
              The model is regenerated from the canonical OULAD-derived dataset and falls back to a
              &quot;model unavailable&quot; signal if the artifact is missing — handled gracefully both here
              and in the planner.
            </p>
          </article>
        )}
      </section>
    </div>
  );
}
