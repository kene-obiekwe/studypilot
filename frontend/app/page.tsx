const modules = [
  "User profile and preferences",
  "Study timetable generation",
  "Adaptive optimisation loop",
  "Learning strategy recommendations",
  "Progress and reflective feedback",
  "Reminder and notification pipeline",
];

export default function HomePage() {
  return (
    <main className="container">
      <div className="card" style={{ marginTop: 16 }}>
        <span className="pill">Final Year Project MVP</span>
        <h1 className="title">AI-Powered Personalised Study Planner</h1>
        <p className="subtitle">
          Mobile-first implementation kickoff aligned with Chapters 1-3 and ready for Chapter 4 documentation.
        </p>
      </div>

      <section className="grid two" style={{ marginTop: 12 }}>
        <article className="card">
          <h2>Core Modules</h2>
          <ul>
            {modules.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>First Sprint Deliverables</h2>
          <ol>
            <li>Student onboarding + authentication</li>
            <li>Planner API with rule-based baseline</li>
            <li>Recommendation API with strategy output</li>
            <li>Progress log endpoint and analytics summary</li>
          </ol>
        </article>
      </section>
    </main>
  );
}
