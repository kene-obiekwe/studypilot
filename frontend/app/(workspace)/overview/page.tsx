import Link from "next/link";
import { BarChart3, Bot, CalendarClock, KeyRound, Sparkles, Target } from "lucide-react";

const projectName = "AI Powered Personalised Study Planning and Learning Recommendation System";

const cards = [
  {
    href: "/auth",
    title: "Sign In and Set Up",
    text: "Create your learner account and access your personalized workspace.",
    icon: KeyRound,
  },
  {
    href: "/planner",
    title: "Build My Study Timetable",
    text: "Generate a weekly plan that matches your available time and course demands.",
    icon: CalendarClock,
  },
  {
    href: "/recommendations",
    title: "Get AI Study Strategies",
    text: "Receive adaptive strategy suggestions based on your focus and completion patterns.",
    icon: Bot,
  },
  {
    href: "/progress",
    title: "Track My Progress",
    text: "Log each session, monitor adherence, and improve your study habits over time.",
    icon: BarChart3,
  },
];

const learnerBenefits = [
  "Reduce stress with structured weekly study planning",
  "Improve consistency with reminders and progress tracking",
  "Use AI suggestions to refine your learning strategy",
];

export default function OverviewPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="hero">
        <span className="kicker">Learner Home</span>
        <h2>{projectName}</h2>
        <p>
          This system is designed for you as a learner. It helps you plan your study time, receive adaptive strategy
          recommendations, and continuously improve study performance through reflection and tracking.
        </p>
      </section>

      <section className="grid two stagger">
        <article className="card">
          <span className="card-icon">
            <Target size={18} />
          </span>
          <h3>Your Quick Start</h3>
          <p>Move through these screens in order for the best experience:</p>
          <ol>
            <li>Authentication: create account or sign in</li>
            <li>Study Planner: generate your weekly timetable</li>
            <li>Recommendations: get AI learning strategy tips</li>
            <li>Progress: log sessions and monitor adherence</li>
          </ol>
        </article>

        <article className="card">
          <span className="card-icon">
            <Sparkles size={18} />
          </span>
          <h3>What You Gain</h3>
          <ul>
            {learnerBenefits.map((benefit) => (
              <li key={benefit}>{benefit}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="grid two stagger">
        {cards.map((card) => {
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
