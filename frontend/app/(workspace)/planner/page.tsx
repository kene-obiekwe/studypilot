"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
        courses: courses.filter((course) => course.name.trim()).map(({ name, difficulty }) => ({ name, difficulty })),
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
    <div className="grid" style={{ gap: 14 }}>
      <section className="hero">
        <span className="kicker">Step 2</span>
        <h2>Personalised Study Planner</h2>
        <p>Allocate available weekly hours based on course difficulty and generate focused study blocks.</p>
      </section>

      {!token && <div className="notice">You are not signed in. Visit Authentication to log in first.</div>}

      <article className="card">
        <h3>Planner Input</h3>
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

          <div className="grid" style={{ gap: 8 }}>
            {courses.map((course) => (
              <div key={course.id} className="grid two">
                <label>
                  Course
                  <input
                    value={course.name}
                    onChange={(e) => updateCourse(course.id, { name: e.target.value })}
                    placeholder="e.g. CSC 401"
                  />
                </label>
                <label>
                  Difficulty (1-5)
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={course.difficulty}
                    onChange={(e) => updateCourse(course.id, { difficulty: Number(e.target.value) })}
                  />
                </label>
                <button type="button" className="secondary" onClick={() => removeCourse(course.id)}>
                  <Trash2 size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Remove
                </button>
              </div>
            ))}
          </div>

          <div className="actions">
            <button type="button" className="secondary" onClick={addCourse}>
              <Plus size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Add Course
            </button>
            <button type="submit" disabled={!token}>
              Generate Plan
            </button>
          </div>
        </form>

        <div className="notice ok">Status: {status}</div>
        {error && <div className="notice error">{error}</div>}
      </article>

      {result && (
        <section className="grid two stagger">
          {result.allocations.map((item) => (
            <article className="card" key={item.course}>
              <h3>{item.course}</h3>
              <div className="pill-row">
                <span className="pill">Hours: {item.allocated_hours}</span>
                <span className="pill">Focus: {item.focus_block_minutes} mins</span>
                <span className="pill">Break: {item.break_minutes} mins</span>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
