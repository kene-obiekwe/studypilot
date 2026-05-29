import Link from "next/link";
import { BarChart3, Bot, CalendarClock, KeyRound, Sparkles, UserPlus } from "lucide-react";

const featureCards = [
  {
    title: "Plan smart study weeks",
    text: "Allocate time by difficulty and generate focus blocks that fit your schedule.",
    icon: CalendarClock,
  },
  {
    title: "Get adaptive strategies",
    text: "Receive tailored learning strategies based on your focus and completion signals.",
    icon: Bot,
  },
  {
    title: "Track adherence",
    text: "Monitor how closely you follow your plan and improve consistency over time.",
    icon: BarChart3,
  },
];

export default function RootPage() {
  return (
    <main className="home-shell">
      <section className="hero home-hero">
        <span className="kicker">
          <Sparkles size={14} /> StudyPilot AI
        </span>
        <h1>AI Powered Personalised Study Planning and Learning Recommendation System</h1>
        <p>
          Build structured study plans, receive adaptive strategies, and track adherence with data-driven insights.
        </p>
        <div className="hero-actions">
          <Link className="button-link" href="/auth">
            <KeyRound size={16} /> Login
          </Link>
          <Link className="button-link secondary" href="/auth">
            <UserPlus size={16} /> Register
          </Link>
        </div>
      </section>

      <section className="grid three">
        {featureCards.map((card) => {
          const Icon = card.icon;
          return (
            <article className="card" key={card.title}>
              <span className="card-icon">
                <Icon size={18} />
              </span>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          );
        })}
      </section>
    </main>
  );
}
