"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarClock, GraduationCap, Plus, Trash2, Wand2 } from "lucide-react";
import { generatePlan, type PlanResponse } from "@/lib/api";
import { getStoredToken } from "@/lib/session";

type CourseInput = {
  id: number;
  name: string;
  difficulty: number;
};

export default function PlannerPage() {
  const [token, setToken] = useState("");
  const [totalHours, setTotalHours] = useState(12);
  const [courses, setCourses] = useState<CourseInput[]>([
    { id: 1, name: "CSC 401", difficulty: 4 },
    { id: 2, name: "MTH 401", difficulty: 3 },
  ]);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlanResponse | null>(null);

  useEffect(() => {
    setToken(getStoredToken());
  }, []);

  const addCourse = () => {
    setCourses((prev) => [...prev, { id: Date.now(), name: "", difficulty: 3 }]);
  };

  const removeCourse = (id: number) => {
    setCourses((prev) => prev.filter((course) => course.id !== id));
  };

  const updateCourse = (id: number, patch: Partial<CourseInput>) => {
    setCourses((prev) => prev.map((course) => (course.id === id ? { ...course, ...patch } : course)));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("Generating timetable...");
    try {
      const payload = {
        total_available_hours: totalHours,
        courses: courses
          .filter((course) => course.name.trim())
          .map(({ name, difficulty }) => ({ name, difficulty })),
      };
      const response = await generatePlan(payload, token);
      setResult(response);
      setStatus("Plan generated successfully");
    } catch (err) {
      setStatus("Generation failed");
      setError((err as Error).message);
    }
  };

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="hero animate-in">
        <span className="kicker">
          <CalendarClock size={12} /> Step 2
        </span>
        <h2>Personalised Study Planner</h2>
        <p>
          Allocate your weekly hours across courses based on difficulty. Recent adherence is folded back in
          so the schedule shrinks where you have been over-extending and grows where you have headroom.
        </p>
      </section>

      {!token && (
        <div className="notice info">You are not signed in. Visit Authentication to log in first.</div>
      )}

      <section className="grid two">
        <article className="card">
          <h3>
            <Wand2 size={16} /> Plan Input
          </h3>
          <form className="form-grid" onSubmit={onSubmit}>
            <label>
              Total available weekly study hours
              <input
                type="number"
                min={1}
                value={totalHours}
                onChange={(e) => setTotalHours(Number(e.target.value))}
              />
            </label>

            <div className="grid" style={{ gap: 10 }}>
              {courses.map((course) => (
                <div
                  key={course.id}
                  className="history-row"
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}
                >
                  <div
                    className="grid"
                    style={{ gap: 8, gridTemplateColumns: "minmax(0, 1fr) 110px" }}
                  >
                    <label>
                      Course
                      <input
                        value={course.name}
                        onChange={(e) => updateCourse(course.id, { name: e.target.value })}
                        placeholder="e.g. CSC 401"
                      />
                    </label>
                    <label>
                      Difficulty
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={course.difficulty}
                        onChange={(e) =>
                          updateCourse(course.id, { difficulty: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => removeCourse(course.id)}
                    aria-label={`Remove ${course.name || "course"}`}
                    style={{ alignSelf: "end" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="actions">
              <button type="button" className="secondary" onClick={addCourse}>
                <Plus size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Add course
              </button>
              <button type="submit" disabled={!token}>
                Generate Plan
              </button>
            </div>
          </form>

          <div className="notice ok">Status: {status}</div>
          {error && <div className="notice error">{error}</div>}
        </article>

        <article className="card">
          <h3>
            <GraduationCap size={16} /> How allocation works
          </h3>
          <p>
            Hours are first split by difficulty weight. If you have recent session logs, the planner
            multiplies each course allocation by an adherence-derived factor: 0.8 for very low adherence,
            up to 1.1 for very high. Allocations are then renormalised so your total weekly hours stay the
            same — only the distribution shifts.
          </p>
          <p className="muted-text">
            New here? Add 3-5 courses with realistic difficulty levels and submit. The result will be saved
            to your planner history.
          </p>
        </article>
      </section>

      {result && (
        <section className="grid four stagger">
          {result.allocations.map((item) => (
            <article className="card" key={item.course}>
              <span className="card-icon">
                <CalendarClock size={18} />
              </span>
              <h3>{item.course}</h3>
              <div className="pill-row">
                <span className="pill accent">{item.allocated_hours}h</span>
                <span className="pill">Focus: {item.focus_block_minutes}m</span>
                <span className="pill">Break: {item.break_minutes}m</span>
              </div>
              {typeof item.adherence_factor === "number" && item.adherence_factor !== 1 && (
                <div className="pill-row" style={{ marginTop: 8 }}>
                  <span className="pill warning">Adj &times;{item.adherence_factor.toFixed(2)}</span>
                  {typeof item.base_hours === "number" && (
                    <span className="pill">Base {item.base_hours}h</span>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
