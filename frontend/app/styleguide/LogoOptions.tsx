import { BookOpen, ChartLine, LayoutDashboard, X } from "lucide-react";

import { Button, Card, Field, Input, NavItem, UiRoot } from "@/components/ui";
import type { ThemeName } from "@/lib/contrast";

import { LogoLockup, LogoMark, type LogoId } from "./logo-marks";
import styles from "./logo-options.module.css";

const OPTIONS: Array<{ id: LogoId; name: string; rationale: string }> = [
  {
    id: "flight",
    name: "A. Flight path",
    rationale:
      "A folded dart climbing to the upper right, trailing three dots for the sessions behind it. It echoes the paper plane in the hero animation.",
  },
  {
    id: "heading",
    name: "B. Heading",
    rationale:
      "The current compass, made ownable: an open dial with a long heading needle that breaks out of it. The pilot sets the heading, and the plan goes beyond the dial.",
  },
  {
    id: "route",
    name: "C. Route S",
    rationale:
      "A monogram drawn as one route, from a start at the lower left, through two turns, to a heading arrow. It reads as an S first and a journey second.",
  },
];

const MARK_SIZES = [16, 24, 32, 48, 96];
const TILE_SIZES = [16, 24, 32, 64];
const LOCKUP_FONTS = [15, 17, 22];

export function LogoOptions() {
  return (
    <section className={styles.wrap} aria-labelledby="logo-options-title">
      <div className={styles.intro}>
        <h2 id="logo-options-title">Logo options</h2>
        <p>
          Three candidates for the mark next to the wordmark (5.8c, step 1). Each is shown at every size, light and
          dark, in one colour, as the app icon and favicon, and in place. Nothing outside this page uses them yet.
        </p>
      </div>
      {OPTIONS.map((option) => (
        <article key={option.id} className={styles.option} aria-labelledby={`logo-${option.id}`}>
          <header className={styles.optionHead}>
            <LogoMark option={option.id} size={40} />
            <div>
              <h3 id={`logo-${option.id}`}>{option.name}</h3>
              <p>{option.rationale}</p>
            </div>
          </header>
          <div className={styles.themes}>
            {(["light", "dark"] as const).map((theme) => (
              <UiRoot key={theme} data-theme={theme} className={styles.panel}>
                <OptionPanel option={option.id} theme={theme} />
              </UiRoot>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function OptionPanel({ option, theme }: { option: LogoId; theme: ThemeName }) {
  return (
    <>
      <h4 className={styles.panelTitle}>{theme === "light" ? "Light" : "Dark"}</h4>

      <div className={styles.block}>
        <span className={styles.label}>Mark, two colour</span>
        <div className={styles.ladder}>
          {MARK_SIZES.map((size) => (
            <figure key={size} className={styles.step}>
              <LogoMark option={option} size={size} />
              <figcaption>{size}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>One colour (ink, and reversed on the accent)</span>
        <div className={styles.ladder}>
          {[16, 32, 48].map((size) => (
            <figure key={size} className={styles.step}>
              <LogoMark option={option} size={size} treatment="mono" />
              <figcaption>{size}</figcaption>
            </figure>
          ))}
          <div className={styles.reversed}>
            <LogoMark option={option} size={16} treatment="mono" />
            <LogoMark option={option} size={32} treatment="mono" />
            <LogoMark option={option} size={48} treatment="mono" />
          </div>
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>App icon and favicon (fixed blue tile)</span>
        <div className={styles.ladder}>
          {TILE_SIZES.map((size) => (
            <figure key={size} className={styles.step}>
              <LogoMark option={option} size={size} treatment="tile" />
              <figcaption>{size}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>Lockups: mark 1.6× and gap 0.45× the font size (15, 17, 22 px)</span>
        <div className={styles.lockups}>
          {LOCKUP_FONTS.map((font) => (
            <LogoLockup key={font} option={option} fontSize={font} />
          ))}
          <LogoLockup option={option} fontSize={17} treatment="tile" />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>In context</span>
        <div className={styles.contexts}>
          <TabMock option={option} />
          <div className={styles.contextRow}>
            <SidebarMock option={option} theme={theme} />
            <AuthMock option={option} theme={theme} />
          </div>
          <LandingMock option={option} />
        </div>
      </div>
    </>
  );
}

function TabMock({ option }: { option: LogoId }) {
  return (
    <div className={styles.tabStrip} aria-hidden="true">
      <div className={`${styles.tab} ${styles.tabActive}`}>
        <LogoMark option={option} size={16} treatment="tile" />
        <span className={styles.tabTitle}>This week · StudyPilot</span>
        <X size={14} />
      </div>
      <div className={styles.tab}>
        <span className={styles.tabOther} />
        <span className={styles.tabTitle}>Inbox</span>
        <X size={14} />
      </div>
    </div>
  );
}

function SidebarMock({ option, theme }: { option: LogoId; theme: ThemeName }) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarBrand}>
        <LogoLockup option={option} fontSize={17} />
      </div>
      <nav aria-label={`Sidebar with option ${option} (${theme})`} className={styles.sidebarNav}>
        <NavItem href="#" label="This week" icon={<LayoutDashboard size={18} />} active />
        <NavItem href="#" label="My courses" icon={<BookOpen size={18} />} />
        <NavItem href="#" label="Progress" icon={<ChartLine size={18} />} />
      </nav>
    </div>
  );
}

function AuthMock({ option, theme }: { option: LogoId; theme: ThemeName }) {
  return (
    <div className={styles.auth}>
      <LogoLockup option={option} fontSize={17} />
      <Card padding="md">
        <div className={styles.authCard}>
          <strong className={styles.authTitle}>Sign in</strong>
          <Field label="Username or email">
            <Input id={`logo-${option}-${theme}-email`} placeholder="you@example.com" />
          </Field>
          <Button variant="primary">Sign in</Button>
        </div>
      </Card>
    </div>
  );
}

function LandingMock({ option }: { option: LogoId }) {
  return (
    <div className={styles.landing}>
      <div className={styles.landingBar}>
        <LogoLockup option={option} fontSize={20} />
        <div className={styles.landingEnd}>
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
          <Button variant="primary" size="sm">
            Get started
          </Button>
        </div>
      </div>
      <div className={styles.landingHero}>
        <LogoMark option={option} size={128} />
        <div>
          <strong className={styles.landingHeadline}>A study plan that adapts to how you study</strong>
          <span className={styles.landingSub}>Large mark at 128 px, for the landing page and social cards.</span>
        </div>
      </div>
    </div>
  );
}
