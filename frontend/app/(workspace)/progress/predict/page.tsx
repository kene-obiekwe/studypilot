"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, Compass, Sparkles } from "lucide-react";

import { predictAdherence, type ForecastItem } from "@/lib/api";
import { clampPercent, useProgress } from "../_lib/shared";

const MIN_WEEKS = 2;

function percent(value: number | null | undefined): string {
  return typeof value === "number" ? `${clampPercent(value).toFixed(0)}%` : "n/a";
}

function trendText(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "n/a";
  }
  const points = Math.round(value * 100);
  if (points === 0) {
    return "flat";
  }
  return `${points > 0 ? "up" : "down"} ${Math.abs(points)} points`;
}

function ForecastCard({ item }: { item: ForecastItem }) {
  if (item.status === "ok") {
    const pct = clampPercent(item.predicted_adherence ?? 0);
    const { adh_lag1, adh_mean3, adh_trend } = item.features;
    return (
      <article className="forecast-card animate-in">
        <span className="stat-label">
          <Activity size={14} /> {item.course_name}
        </span>
        <p className="stat-value">{pct.toFixed(0)}%</p>
        <div className="progress-wrap">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <p className="stat-meta" style={{ marginTop: 12 }}>
          Forecast for next week, from your last week ({percent(adh_lag1)}), your 3-week average (
          {percent(adh_mean3)}) and your trend ({trendText(adh_trend)}), over {item.weeks_history} week
          {item.weeks_history === 1 ? "" : "s"} of history.
        </p>
        <hr className="divider" />
        <div className="pill-row">
          <span className="pill">last week {percent(adh_lag1)}</span>
          <span className="pill">3-week average {percent(adh_mean3)}</span>
          <span className="pill">trend {trendText(adh_trend)}</span>
          <span className="pill accent">{item.weeks_history} weeks of history</span>
        </div>
        {item.model_version && <p className="stat-meta">Model version: {item.model_version}</p>}
      </article>
    );
  }

  const message =
    item.status === "insufficient_history"
      ? `Needs at least ${MIN_WEEKS} complete weeks of logged sessions for this course (you have ${item.weeks_history}).`
      : "Forecast unavailable right now. The planner falls back to your recent average.";
  return (
    <article className="card">
      <h3>
        <Activity size={16} /> {item.course_name}
      </h3>
      <p>{message}</p>
    </article>
  );
}

export default function ProgressPredictPage() {
  const { signedIn } = useProgress();
  const [status, setStatus] = useState("Loading forecasts...");
  const [error, setError] = useState("");
  const [forecasts, setForecasts] = useState<ForecastItem[] | null>(null);

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    let cancelled = false;
    predictAdherence()
      .then((items) => {
        if (!cancelled) {
          setForecasts(items);
          setStatus("Forecasts ready");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus("Forecast failed");
          setError((err as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!signedIn) {
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
          <Sparkles size={12} /> Predictor
        </span>
        <h2>Your Next-Week Forecast</h2>
        <p>
          The forecast estimates how much of your plan you will complete next week, from your recent weeks of
          logged sessions. The planner uses it to adjust the hours it gives each course.
        </p>
      </section>

      <section className="grid two stagger">
        <article className="card">
          <h3>
            <Compass size={16} /> What You Get
          </h3>
          <p>
            Each course you have logged gets its own forecast: a number between 0% and 100% for the share of
            planned time you are expected to complete. A course needs at least {MIN_WEEKS} complete weeks of
            logged sessions before it can be forecast.
          </p>
          <div className="notice ok">Status: {status}</div>
          {error && <div className="notice error">{error}</div>}
        </article>

        {forecasts !== null && forecasts.length === 0 && (
          <article className="card">
            <h3>
              <Activity size={16} /> No forecasts yet
            </h3>
            <p>
              Log a few sessions first, then come back. <Link href="/progress/log">Log a session</Link>
            </p>
          </article>
        )}

        {forecasts?.map((item) => (
          <ForecastCard key={item.course_name.toLowerCase()} item={item} />
        ))}
      </section>
    </div>
  );
}
