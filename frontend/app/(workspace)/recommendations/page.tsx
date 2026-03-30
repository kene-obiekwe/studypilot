"use client";

import { FormEvent, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { generateRecommendations, type RecommendationResponse } from "@/lib/api";
import { getStoredToken } from "@/lib/session";

export default function RecommendationsPage() {
  const [token, setToken] = useState("");
  const [focusScore, setFocusScore] = useState(0.6);
  const [completionRate, setCompletionRate] = useState(0.5);
  const [preferredStyle, setPreferredStyle] = useState<"visual" | "reading" | "practice" | "mixed">("mixed");
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(getStoredToken());
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("Generating recommendations...");
    try {
      const response = await generateRecommendations(
        {
          focus_score: focusScore,
          completion_rate: completionRate,
          preferred_style: preferredStyle,
        },
        token
      );
      setResult(response);
      setStatus("Recommendations ready");
    } catch (err) {
      setError((err as Error).message);
      setStatus("Request failed");
    }
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      <section className="hero">
        <span className="kicker">Step 3</span>
        <h2>AI Strategy Recommendations</h2>
        <p>Use behavioural indicators to return adaptive, practical study strategy guidance.</p>
      </section>

      {!token && <div className="notice">You are not signed in. Visit Authentication to log in first.</div>}

      <article className="card">
        <h3>
          <Sparkles size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} /> Recommendation Inputs
        </h3>

        <form className="form-grid" onSubmit={onSubmit}>
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
            Preferred learning style
            <select value={preferredStyle} onChange={(e) => setPreferredStyle(e.target.value as typeof preferredStyle)}>
              <option value="mixed">mixed</option>
              <option value="visual">visual</option>
              <option value="reading">reading</option>
              <option value="practice">practice</option>
            </select>
          </label>

          <button type="submit" disabled={!token}>
            Generate Recommendations
          </button>
        </form>

        <div className="notice ok">Status: {status}</div>
        {error && <div className="notice error">{error}</div>}
      </article>

      {result && (
        <article className="card animate-in">
          <h3>Recommended Strategy Set</h3>
          <ul>
            {result.strategies.map((strategy) => (
              <li key={strategy}>{strategy}</li>
            ))}
          </ul>
        </article>
      )}
    </div>
  );
}
