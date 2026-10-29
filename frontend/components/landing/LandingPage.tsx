import Link from "next/link";
import { Suspense } from "react";
import { CalendarDays, ExternalLink, Lightbulb, TrendingUp } from "lucide-react";

import { Lockup } from "@/components/brand";
import { ThemeToggle, UiRoot } from "@/components/ui";

import { AccountDeletedNotice } from "./AccountDeletedNotice";
import { AuthActions } from "./AuthActions";
import { HeroVideo } from "./HeroVideo";
import styles from "./landing.module.css";

export const REPO_URL = "https://github.com/kene-obiekwe/studypilot";
export const EVALUATION_URL = `${REPO_URL}/blob/master/docs/evaluation-report.md`;

export const HEADLINE = "A study plan that adapts to how you actually study";
export const SUBCOPY =
  "Add your courses and StudyPilot splits your weekly hours by difficulty, suggests techniques for each course, and adjusts next week’s plan from the sessions you log.";

// These mirror the three cards in the animation, whose baked-in text isn't accessible.
const FEATURES = [
  {
    icon: CalendarDays,
    title: "A study plan that fits your week",
    text: "Your hours are split across your courses by difficulty, then nudged up or down by a forecast of how much of each course’s plan you’re likely to complete.",
  },
  {
    icon: Lightbulb,
    title: "Strategies chosen for each course",
    text: "Up to four evidence-based techniques per course, picked from how it’s assessed and how your sessions are going, each with the reason it was chosen and its source.",
  },
  {
    icon: TrendingUp,
    title: "Progress you can see, a forecast you can check",
    text: "A study timer, a history of every session, and a next-week forecast that’s been tested against simple baselines.",
  },
];

const STEPS = [
  {
    title: "Add your courses",
    text: "Name each course and say how it’s assessed. StudyPilot suggests its traits; you confirm them.",
  },
  {
    title: "Get this week’s plan",
    text: "Hours for each course, plus the techniques to use in them and why.",
  },
  {
    title: "Log sessions and the plan adapts",
    text: "Time a session or log it afterwards. Your logs shape next week’s forecast and plan.",
  },
];

// The sources the recommendation engine cites for each technique (backend engine library).
const RESEARCH = [
  { technique: "Retrieval practice", source: "Roediger & Karpicke, 2006" },
  { technique: "Spacing", source: "Cepeda et al., 2006" },
  { technique: "Interleaving", source: "Rohrer & Taylor, 2007" },
  { technique: "Worked examples", source: "Sweller & Cooper, 1985" },
  { technique: "Self-explanation", source: "Chi et al., 1989" },
];

function Wordmark() {
  return (
    <Link href="/" className={styles.wordmark}>
      <Lockup fontSize={17} />
    </Link>
  );
}

export function LandingPage() {
  return (
    <UiRoot className={styles.page}>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Wordmark />
          <div className={styles.headerEnd}>
            <ThemeToggle className={styles.themeToggle} />
            <AuthActions placement="header" />
          </div>
        </div>
      </header>

      <main id="main" className={styles.main}>
        <Suspense fallback={null}>
          <AccountDeletedNotice className={styles.flash} />
        </Suspense>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroText}>
            <h1 id="hero-title" className={styles.headline}>
              {HEADLINE}
            </h1>
            <p className={styles.lede}>{SUBCOPY}</p>
            <AuthActions placement="hero" />
          </div>
          <HeroVideo />
        </section>

        <section className={styles.section} aria-labelledby="features-title">
          <h2 id="features-title" className={styles.srOnly}>
            What StudyPilot does
          </h2>
          <ul className={styles.features}>
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <Icon size={20} />
                </span>
                <h3 className={styles.featureTitle}>{title}</h3>
                <p className={styles.featureText}>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="how-title">
          <h2 id="how-title" className={styles.sectionTitle}>
            How it works
          </h2>
          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepText}>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className={styles.band}>
          <div className={styles.bandInner}>
            <section className={styles.research} aria-labelledby="research-title">
              <div>
                <h2 id="research-title" className={styles.sectionTitle}>
                  Built on research
                </h2>
                <p className={styles.sectionLede}>
                  Every technique StudyPilot suggests comes with the study behind it, so you can read the evidence
                  yourself.
                </p>
              </div>
              <ul className={styles.researchList}>
                {RESEARCH.map((item) => (
                  <li key={item.technique} className={styles.researchItem}>
                    <span className={styles.researchTechnique}>{item.technique}</span>
                    <span className={styles.researchSource}>{item.source}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.modelNote} aria-labelledby="forecast-title">
              <h2 id="forecast-title" className={styles.modelTitle}>
                About the forecast
              </h2>
              <p>
                The next-week forecast is a model trained on weekly activity from the Open University Learning
                Analytics Dataset (OULAD) and compared against simple baselines, such as a three-week average. The
                evaluation report has the numbers and the limitations.
              </p>
              <a href={EVALUATION_URL} className={styles.textLink} target="_blank" rel="noopener noreferrer">
                Read the evaluation report
                <ExternalLink size={14} aria-hidden="true" />
                <span className={styles.srOnly}> (opens in a new tab)</span>
              </a>
            </section>
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Wordmark />
          <a href={REPO_URL} className={styles.footerLink} target="_blank" rel="noopener noreferrer">
            Source code on GitHub
            <span className={styles.srOnly}> (opens in a new tab)</span>
          </a>
          <p className={styles.credit}>Built by Kene Obiekwe</p>
        </div>
      </footer>
    </UiRoot>
  );
}
