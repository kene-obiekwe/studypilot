import Link from "next/link";
import {
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Compass,
  KeyRound,
  Sparkles,
  Target,
} from "lucide-react";

const projectName = "AI Powered Personalised Study Planning and Learning Recommendation System";

const journey = [
  {
    href: "/auth",
    title: "Sign in",
    text: "Authenticate and access your personalised workspace.",
    icon: KeyRound,
  },
  {
    href: "/planner",
    title: "Build my timetable",
    text: "Generate a weekly plan that matches your time and course difficulty.",
    icon: CalendarClock,
  },
  {
    href: "/recommendations",
    title: "Get AI strategies",
    text: "Receive adaptive strategy suggestions from your focus and completion patterns.",
    icon: Bot,
  },
  {
    href: "/progress",
    title: "Track and forecast",
    text: "Log sessions, preview adherence forecasts, and refine habits.",
    icon: BarChart3,
  },
];

const benefits = [
  "Structured weekly study planning that reduces stress",
  "Adaptive AI suggestions tuned to your behaviour",
  "Adherence forecasts before each session to calibrate intensity",
  "Reflective analytics across plans, recommendations, and sessions",
];

export default function OverviewPage() {
  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="hero animate-in">
        <span className="kicker">
          <Compass size={12} /> Learner Home
        </span>
        <h2>{projectName}</h2>
        <p>
          This workspace turns your courses, available time, and recent behaviour into a personalised
          weekly plan and adaptive learning strategies. Move through the journey below or jump straight to
          a tool from the navigation.
        </p>
      </section>

      <section className="grid two stagger">
        <article className="card">
          <span className="card-icon">
            <Target size={18} />
          </span>
          <h3>Your quick start</h3>
          <p>Use these steps in order the first time you sign in:</p>
          <ol>
            <li>Authentication — create or sign in to your account.</li>
            <li>Study Planner — generate your weekly timetable.</li>
            <li>Recommendations — receive AI strategy guidance.</li>
            <li>Progress — log sessions, forecast adherence, and review history.</li>
          </ol>
        </article>

        <article className="card">
          <span className="card-icon">
            <Sparkles size={18} />
          </span>
          <h3>What you gain</h3>
          <ul>
            {benefits.map((benefit) => (
              <li key={benefit}>
                <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 6, color: "var(--sky-600)" }} />
                {benefit}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="grid four stagger">
        {journey.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={card.href} className="surface-link card">
              <span className="card-icon">
                <Icon size={18} />
              </span>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
