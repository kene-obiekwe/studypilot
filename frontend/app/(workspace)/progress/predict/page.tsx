"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";

import { Badge, EmptyState, Notice, ProgressBar, Skeleton } from "@/components/ui";
import { predictAdherence, type ForecastItem } from "@/lib/api";

import styles from "../_lib/progress.module.css";
import { useSavedCourses } from "../_lib/useSavedCourses";

const MIN_WEEKS = 2;

function percent(value: number | null | undefined): string {
  return typeof value === "number" ? `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` : "n/a";
}

function trendText(value: number | null | undefined): string {
  if (typeof value !== "number") return "n/a";
  const points = Math.round(value * 100);
  if (points === 0) return "flat";
  return `${points > 0 ? "up" : "down"} ${Math.abs(points)} points`;
}

function ForecastCard({ item, colorStyle }: { item: ForecastItem; colorStyle: CSSProperties | undefined }) {
  const title = (
    <h2 className={styles.cardTitle}>
      <span className={styles.dot} aria-hidden="true" />
      {item.course_name}
    </h2>
  );

  if (item.status === "ok") {
    const forecast = Math.min(1, Math.max(0, item.predicted_adherence ?? 0));
    const { adh_lag1, adh_mean3, adh_trend } = item.features;
    return (
      <li className={styles.card} style={colorStyle}>
        {title}
        <p className={styles.bigNumber}>{percent(forecast)}</p>
        <ProgressBar label={`${item.course_name} forecast`} value={forecast} max={1} hideHeader valueText={`${percent(forecast)} forecast`} />
        <p className={styles.muted}>
          Next week, from your last week ({percent(adh_lag1)}), your 3-week average ({percent(adh_mean3)}) and your trend (
          {trendText(adh_trend)}), over {item.weeks_history} {item.weeks_history === 1 ? "week" : "weeks"} of history.
        </p>
        <div className={styles.facts}>
          <Badge>Last week {percent(adh_lag1)}</Badge>
          <Badge>3-week average {percent(adh_mean3)}</Badge>
          <Badge>Trend {trendText(adh_trend)}</Badge>
        </div>
        {item.model_version && <p className={styles.muted}>Model {item.model_version}</p>}
      </li>
    );
  }

  const message =
    item.status === "insufficient_history"
      ? `Needs at least ${MIN_WEEKS} complete weeks of logged sessions for this course (you have ${item.weeks_history}).`
      : "Forecast unavailable right now. The planner falls back to your recent average.";
  return (
    <li className={styles.card} style={colorStyle}>
      {title}
      <p className={styles.muted}>{message}</p>
    </li>
  );
}

export default function ProgressPredictPage() {
  const [forecasts, setForecasts] = useState<ForecastItem[] | null>(null);
  const [error, setError] = useState("");
  const { colorStyle } = useSavedCourses();

  useEffect(() => {
    let cancelled = false;
    predictAdherence()
      .then((items) => {
        if (!cancelled) setForecasts(items);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError((failure as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.page}>
      <p className={styles.muted}>
        The forecast estimates how much of your plan you will complete next week, from your recent weeks of
        logged sessions. The planner uses it to adjust the hours it gives each course. A course needs at least{" "}
        {MIN_WEEKS} complete weeks of logged sessions before it can be forecast.
      </p>

      {error && (
        <Notice tone="danger" title="Could not load your forecasts">
          {error}
        </Notice>
      )}

      {forecasts === null && !error && (
        <div className={styles.cards} aria-busy="true" aria-label="Loading your forecasts">
          <Skeleton height={180} radius="lg" />
          <Skeleton height={180} radius="lg" />
        </div>
      )}

      {forecasts !== null && forecasts.length === 0 && (
        <EmptyState
          title="No forecasts yet"
          description="Log a few sessions first, then come back."
          action={
            <Link href="/progress/log" className={styles.link}>
              Log a session
            </Link>
          }
        />
      )}

      {forecasts !== null && forecasts.length > 0 && (
        <ul className={styles.cards} aria-label="Forecast by course">
          {forecasts.map((item) => (
            <ForecastCard key={item.course_name.toLowerCase()} item={item} colorStyle={colorStyle(item.course_name)} />
          ))}
        </ul>
      )}
    </div>
  );
}
