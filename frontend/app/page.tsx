import Link from "next/link";
import {
  BarChart3,
  Bot,
  Brain,
  CalendarClock,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";

const featureCards = [
  {
    title: "Plan smart study weeks",
    text: "Allocate time by difficulty and generate focus blocks that fit your week.",
    icon: CalendarClock,
  },
  {
    title: "Adapt with AI strategies",
    text: "Receive tailored learning strategies based on your focus and completion signals.",
    icon: Bot,
  },
  {
    title: "Forecast adherence",
    text: "See predicted adherence before each session so you can calibrate intensity.",
    icon: Brain,
  },
  {
    title: "Track every session",
    text: "Log outcomes, see analytics across courses, and improve consistency over time.",
    icon: BarChart3,
  },
];

const trustBadges = [
  { label: "Rule + ML hybrid", icon: ShieldCheck },
  { label: "Privacy-aware data", icon: CheckCircle2 },
  { label: "Mobile-first", icon: Sparkles },
];

export default function RootPage() {
  return (
    <main className="home-shell">
      <section className="hero home-hero animate-in">
        <span className="kicker">
          <Sparkles size={12} /> StudyPilot AI
        </span>
        <h1>AI-Powered Personalised Study Planning &amp; Learning Recommendation</h1>
        <p>
          Generate structured study plans, receive adaptive learning strategies, and track adherence with
          data-driven insights — designed for undergraduates and built mobile-first.
        </p>
        <div className="hero-actions">
          <Link className="button-link" href="/auth">
            <KeyRound size={16} /> Login
          </Link>
          <Link className="button-link secondary" href="/auth">
            <UserPlus size={16} /> Create account
          </Link>
        </div>
        <div className="pill-row" style={{ marginTop: 18 }}>
          {trustBadges.map(({ label, icon: Icon }) => (
            <span key={label} className="pill accent">
              <Icon size={12} /> {label}
            </span>
          ))}
        </div>
      </section>

      <section className="grid four stagger">
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
