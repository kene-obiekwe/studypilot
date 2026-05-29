"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bot, Lightbulb, Sparkles, Wand2 } from "lucide-react";
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
        token,
      );
      setResult(response);
      setStatus("Recommendations ready");
    } catch (err) {
      setError((err as Error).message);
      setStatus("Request failed");
    }
  };

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="hero animate-in">
        <span className="kicker">
          <Bot size={12} /> Step 3
        </span>
        <h2>AI Strategy Recommendations</h2>
        <p>
          Tell the engine how recent sessions have been going and pick a learning style preference. It
          returns a short, practical strategy set with a confidence score derived from how distinctive your
          signals are.
        </p>
      </section>

      {!token && (
        <div className="notice info">You are not signed in. Visit Authentication to log in first.</div>
      )}

      <section className="grid two">
        <article className="card">
          <h3>
            <Wand2 size={16} /> Recommendation Inputs
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
              <select
                value={preferredStyle}
                onChange={(e) => setPreferredStyle(e.target.value as typeof preferredStyle)}
              >
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

        <article className="card">
          <h3>
            <Lightbulb size={16} /> What this engine actually does
          </h3>
          <p>
            Task B is a transparent rule engine, not a supervised classifier. Strategies are selected from
            your focus / completion signals and your stated style preference. The confidence score
            increases as your signals deviate further from the midpoint — high-signal inputs map to higher
            confidence.
          </p>
          <p className="muted-text">
            A supervised classifier is deferred until enough in-app strategy outcomes are available. See
            <code> docs/ai-methodology.md</code> for the rationale.
          </p>
        </article>
      </section>

      {result && (
        <section className="grid stagger" style={{ gap: 12 }}>
          <article className="card animate-in">
            <div className="section-head">
              <h3>
                <Sparkles size={16} /> Recommended Strategy Set
              </h3>
              <span className="pill accent">{(result.confidence * 100).toFixed(0)}% confidence</span>
            </div>
            <ul className="strategy-list">
              {result.strategies.map((strategy) => (
                <li key={strategy}>{strategy}</li>
              ))}
            </ul>
          </article>
        </section>
      )}
    </div>
  );
}
