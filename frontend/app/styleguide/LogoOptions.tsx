import { BookOpen, ChartLine, LayoutDashboard, X } from "lucide-react";

import { Button, Card, Field, Input, NavItem, UiRoot } from "@/components/ui";
import type { ThemeName } from "@/lib/contrast";

import { Lockup, LogoMark } from "@/components/brand";

import styles from "./logo-options.module.css";

const MARK_SIZES = [16, 24, 32, 48, 96];
const TILE_SIZES = [16, 24, 32, 64];
const LOCKUP_FONTS = [15, 17, 22];

export function LogoOptions() {
  return (
    <section className={styles.wrap} aria-labelledby="logo-options-title">
      <div className={styles.intro}>
        <h2 id="logo-options-title">Logo</h2>
        <p>
          The Flight path mark: a folded dart climbing to the upper right, trailing three dots for the sessions behind
          it. It echoes the paper plane in the hero animation. Shown at every size, light and dark, in one colour, as
          the app icon and favicon, and in place.
        </p>
      </div>
      <article className={styles.option} aria-label="Flight path mark">
        <div className={styles.themes}>
          {(["light", "dark"] as const).map((theme) => (
            <UiRoot key={theme} data-theme={theme} className={styles.panel}>
              <OptionPanel theme={theme} />
            </UiRoot>
          ))}
        </div>
      </article>
    </section>
  );
}

function OptionPanel({ theme }: { theme: ThemeName }) {
  return (
    <>
      <h4 className={styles.panelTitle}>{theme === "light" ? "Light" : "Dark"}</h4>

      <div className={styles.block}>
        <span className={styles.label}>Mark, two colour</span>
        <div className={styles.ladder}>
          {MARK_SIZES.map((size) => (
            <figure key={size} className={styles.step}>
              <LogoMark size={size} />
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
              <LogoMark size={size} treatment="mono" />
              <figcaption>{size}</figcaption>
            </figure>
          ))}
          <div className={styles.reversed}>
            <LogoMark size={16} treatment="mono" />
            <LogoMark size={32} treatment="mono" />
            <LogoMark size={48} treatment="mono" />
          </div>
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>App icon and favicon (fixed blue tile)</span>
        <div className={styles.ladder}>
          {TILE_SIZES.map((size) => (
            <figure key={size} className={styles.step}>
              <LogoMark size={size} treatment="tile" />
              <figcaption>{size}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>Lockups: mark 1.6× and gap 0.45× the font size (15, 17, 22 px)</span>
        <div className={styles.lockups}>
          {LOCKUP_FONTS.map((font) => (
            <Lockup key={font} fontSize={font} />
          ))}
          <Lockup fontSize={17} treatment="tile" />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>In context</span>
        <div className={styles.contexts}>
          <TabMock />
          <div className={styles.contextRow}>
            <SidebarMock theme={theme} />
            <AuthMock theme={theme} />
          </div>
          <LandingMock />
        </div>
      </div>
    </>
  );
}

function TabMock() {
  return (
    <div className={styles.tabStrip} aria-hidden="true">
      <div className={`${styles.tab} ${styles.tabActive}`}>
        <LogoMark size={16} treatment="tile" />
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

function SidebarMock({ theme }: { theme: ThemeName }) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarBrand}>
        <Lockup fontSize={17} />
      </div>
      <nav aria-label={`Sidebar (${theme})`} className={styles.sidebarNav}>
        <NavItem href="#" label="This week" icon={<LayoutDashboard size={18} />} active />
        <NavItem href="#" label="My courses" icon={<BookOpen size={18} />} />
        <NavItem href="#" label="Progress" icon={<ChartLine size={18} />} />
      </nav>
    </div>
  );
}

function AuthMock({ theme }: { theme: ThemeName }) {
  return (
    <div className={styles.auth}>
      <Lockup fontSize={17} />
      <Card padding="md">
        <div className={styles.authCard}>
          <strong className={styles.authTitle}>Sign in</strong>
          <Field label="Username or email">
            <Input id={`logo-${theme}-email`} placeholder="you@example.com" />
          </Field>
          <Button variant="primary">Sign in</Button>
        </div>
      </Card>
    </div>
  );
}

function LandingMock() {
  return (
    <div className={styles.landing}>
      <div className={styles.landingBar}>
        <Lockup fontSize={20} />
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
        <LogoMark size={128} />
        <div>
          <strong className={styles.landingHeadline}>A study plan that adapts to how you study</strong>
          <span className={styles.landingSub}>Large mark at 128 px, for the landing page and social cards.</span>
        </div>
      </div>
    </div>
  );
}
