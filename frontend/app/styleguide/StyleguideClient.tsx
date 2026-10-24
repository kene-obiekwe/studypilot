"use client";

import { useState, type CSSProperties } from "react";
import { BookOpen, CalendarDays, ChartLine, Inbox, LayoutDashboard, Play, Plus, Settings, Timer } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Checkbox,
  CourseDot,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  Input,
  List,
  ListRow,
  NavItem,
  Notice,
  ProgressBar,
  SegmentedControl,
  Select,
  Skeleton,
  Stat,
  Textarea,
  ThemeToggle,
  UiRoot,
} from "@/components/ui";
import type { ContrastResult, ThemeName, ThemeTokens } from "@/lib/contrast";
import { COURSE_HUES, courseColor } from "@/lib/course-colors";

import styles from "./styleguide.module.css";

type Props = {
  tokens: Record<ThemeName, ThemeTokens>;
  contrast: ContrastResult[];
};

const COLOUR_GROUPS: Array<{ title: string; names: string[] }> = [
  { title: "Surfaces", names: ["canvas", "surface", "raised", "sunken"] },
  { title: "Text and lines", names: ["ink", "ink-soft", "muted", "line", "line-strong"] },
  { title: "Accent", names: ["accent", "accent-hover", "accent-soft", "accent-ink", "on-accent", "focus"] },
  { title: "Exam / warning", names: ["exam", "on-exam", "exam-strong", "exam-soft", "exam-ink"] },
  {
    title: "Status",
    names: ["success", "success-soft", "success-ink", "danger", "danger-hover", "danger-soft", "danger-ink", "on-danger"],
  },
];

const TYPE_SCALE = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "stat"];
const SPACE_SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function StyleguideClient({ tokens, contrast }: Props) {
  return (
    <UiRoot className={styles.page}>
      <header className={styles.top}>
        <div>
          <h1>StudyPilot design system</h1>
          <p>Development only. Tokens, contrast and every component state, light and dark side by side.</p>
        </div>
        <div className={styles.row}>
          <span>Page theme</span>
          <ThemeToggle />
        </div>
      </header>
      <div className={styles.columns}>
        {(["light", "dark"] as const).map((theme) => (
          <UiRoot key={theme} data-theme={theme} className={styles.panel}>
            <h2 className={styles.panelTitle}>{theme === "light" ? "Light" : "Dark"}</h2>
            <Tokens theme={theme} tokens={tokens[theme]} contrast={contrast.filter((r) => r.theme === theme)} />
            <Components theme={theme} />
          </UiRoot>
        ))}
      </div>
    </UiRoot>
  );
}

function Tokens({ theme, tokens, contrast }: { theme: ThemeName; tokens: ThemeTokens; contrast: ContrastResult[] }) {
  const key = contrast.filter((r) => !r.foreground.startsWith("course-"));
  return (
    <>
      {COLOUR_GROUPS.map((group) => (
        <section key={group.title} className={styles.section}>
          <h3>{group.title}</h3>
          <div className={styles.swatches}>
            {group.names.map((name) => (
              <div key={name} className={styles.swatch}>
                <div className={styles.chip} style={{ background: `var(--sp-${name})` }} />
                <div className={styles.swatchText}>
                  <span className={styles.swatchName}>{name}</span>
                  <span className={styles.swatchValue}>{tokens[name]}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className={styles.section}>
        <h3>Contrast ({theme})</h3>
        <ContrastTable results={key} />
      </section>

      <section className={styles.section}>
        <h3>Course palette</h3>
        <div className={styles.courses}>
          {COURSE_HUES.map((hue, index) => {
            const results = contrast.filter((r) => r.foreground.startsWith(`course-${index}-`));
            const text = results.find((r) => r.foreground.endsWith("-ink"));
            const dot = results.find((r) => r.foreground.endsWith("-dot") && r.background === "surface");
            return (
              <div key={hue} className={styles.courseTile} style={courseColor(index).style}>
                <strong>
                  <CourseDot courseId={index} /> {hue}
                </strong>
                <ProgressBar label={`Course ${index}`} value={2.1} max={3.5} valueText="2.1 of 3.5 h" courseId={index} hideHeader />
                <span className={styles.swatchValue} style={{ color: "inherit" }}>
                  Text {text?.ratio.toFixed(2)} · Bar {dot?.ratio.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h3>Type scale</h3>
        {TYPE_SCALE.map((size) => (
          <div key={size} style={{ fontSize: `var(--sp-text-${size})`, lineHeight: "var(--sp-leading-tight)" }}>
            {size} · <span style={{ fontWeight: "var(--sp-weight-strong)" as CSSProperties["fontWeight"] }}>Semibold</span> · Regular ·{" "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>2.1 of 3.5 h · 76%</span>
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h3>Spacing, radius, shadow</h3>
        {SPACE_SCALE.map((step) => (
          <div key={step} className={styles.row}>
            <span className={styles.swatchValue} style={{ width: 70 }}>
              space-{step}
            </span>
            <div className={styles.scaleBox} style={{ width: `var(--sp-space-${step})` }} />
          </div>
        ))}
        <div className={styles.row}>
          {["sm", "md", "lg", "pill"].map((radius) => (
            <div key={radius} className={styles.radiusBox} style={{ borderRadius: `var(--sp-radius-${radius})` }} title={radius} />
          ))}
        </div>
        <div className={styles.row}>
          {[1, 2, 3].map((level) => (
            <div key={level} className={styles.shadowBox} style={{ boxShadow: `var(--sp-shadow-${level})` }}>
              shadow-{level}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function ContrastTable({ results }: { results: ContrastResult[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Sample</th>
          <th>Pair</th>
          <th>Ratio</th>
          <th>Min</th>
          <th>Use</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={`${r.foreground}-${r.background}`}>
            <td>
              <span className={styles.sample} style={{ color: `var(--sp-${r.foreground})`, background: `var(--sp-${r.background})` }}>
                Aa
              </span>
            </td>
            <td>
              {r.foreground} / {r.background}
            </td>
            <td>
              <span className={r.pass ? styles.pass : styles.fail}>{r.ratio.toFixed(2)}</span>
            </td>
            <td>{r.min}</td>
            <td>{r.use}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Components({ theme }: { theme: ThemeName }) {
  const [segment, setSegment] = useState<"week" | "month" | "term">("week");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const prefix = `${theme}-demo`;

  return (
    <>
      <section className={styles.section}>
        <h3>Buttons</h3>
        <div className={styles.row}>
          <Button variant="primary" icon={<Play size={16} />}>
            Log a session
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete course</Button>
        </div>
        <div className={styles.row}>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="secondary" size="sm" icon={<Plus size={14} />}>
            Add course
          </Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <IconButton aria-label="Settings" icon={<Settings size={18} />} />
          <IconButton aria-label="Add" icon={<Plus size={16} />} variant="secondary" size="sm" />
        </div>
      </section>

      <section className={styles.section}>
        <h3>Fields</h3>
        <div className={styles.grid2}>
          <Field label="Course name" hint="As it appears on your timetable">
            <Input id={`${prefix}-name`} placeholder="e.g. MTH 201 Calculus" />
          </Field>
          <Field label="Hours this week" error="Enter a number between 1 and 168" required>
            <Input id={`${prefix}-hours`} defaultValue="200" inputMode="decimal" />
          </Field>
          <Field label="Assessment">
            <Select id={`${prefix}-format`} defaultValue="timed_problem_exam">
              <option value="timed_problem_exam">Timed problem exam</option>
              <option value="essay_exam">Essay exam</option>
              <option value="coursework">Coursework</option>
            </Select>
          </Field>
          <Field label="Disabled">
            <Input id={`${prefix}-disabled`} disabled defaultValue="Can't edit" />
          </Field>
        </div>
        <Field label="Notes" hint="Optional">
          <Textarea id={`${prefix}-notes`} placeholder="What did you work on?" />
        </Field>
        <div className={styles.row}>
          <Checkbox
            id={`${prefix}-check`}
            label="Tried it"
            hint="Sends feedback on this strategy"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <Checkbox id={`${prefix}-check2`} label="Unchecked" />
          <Checkbox id={`${prefix}-check3`} label="Disabled" disabled />
        </div>
      </section>

      <section className={styles.section}>
        <h3>Segmented control</h3>
        <SegmentedControl
          label="Range"
          value={segment}
          onChange={setSegment}
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
            { value: "term", label: "Term" },
          ]}
        />
      </section>

      <section className={styles.section}>
        <h3>Badges</h3>
        <div className={styles.row}>
          <Badge>Neutral</Badge>
          <Badge tone="accent">Forecast 76%</Badge>
          <Badge tone="exam" icon={<CalendarDays size={12} />}>
            Exam in 18 days
          </Badge>
          <Badge tone="success">On track</Badge>
          <Badge tone="danger">Behind</Badge>
          {[0, 1, 2, 3].map((id) => (
            <Badge key={id} tone="course" courseId={id}>
              {COURSE_HUES[id]}
            </Badge>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3>Progress and stats</h3>
        <ProgressBar label="Calculus" value={2.1} max={3.5} valueText="2.1 of 3.5 h" courseId={0} />
        <ProgressBar label="Modern Physics" value={3.5} max={3.5} valueText="3.5 of 3.5 h" courseId={5} />
        <ProgressBar label="Accent (no course)" value={1} max={4} valueText="1 of 4 h" />
        <div className={styles.row} style={{ gap: "var(--sp-space-8)" }}>
          <Stat label="This week" value="7.5" unit="of 12 h" />
          <Stat label="Forecast" value="76%" hint="Next week, from 4 weeks" />
          <Stat label="Exam" value="18" unit="days" />
        </div>
      </section>

      <section className={styles.section}>
        <h3>Card and list rows</h3>
        <Card>
          <div className={styles.row} style={{ justifyContent: "space-between" }}>
            <strong>
              <CourseDot courseId={0} /> Calculus
            </strong>
            <Badge tone="exam">Exam in 18 days</Badge>
          </div>
          <div style={{ marginTop: "var(--sp-space-3)" }}>
            <ProgressBar label="This week" value={2.1} max={3.5} valueText="2.1 of 3.5 h" courseId={0} />
          </div>
          <p style={{ margin: "var(--sp-space-3) 0 0", color: "var(--sp-ink-soft)" }}>
            Split 90-minute sessions into 3 sessions of 30 minutes.
          </p>
          <Disclosure>Your 90+ minute sessions averaged 35% completion (4 sessions), against 72% for shorter ones (4).</Disclosure>
        </Card>
        <List>
          <ListRow leading={<CourseDot courseId={1} />} title="Algorithms" description="Tue · 45 min · focus 80%" trailing={<Badge tone="accent">On plan</Badge>} />
          <ListRow leading={<CourseDot courseId={4} />} title="Software Engineering" description="Mon · 90 min · focus 55%" trailing="1.5 h" />
          <ListRow leading={<Timer size={16} />} title="A long title that should truncate cleanly when the row is narrow" trailing="—" />
        </List>
      </section>

      <section className={styles.section}>
        <h3>Notices</h3>
        <Notice tone="info" title="Plans adapt as you log">
          Your forecast updates after each complete week.
        </Notice>
        <Notice tone="success" title="Session logged" />
        <Notice tone="warning" title="Exam in 6 days">
          Switch to full mock exams this week.
        </Notice>
        <Notice tone="danger" title="Couldn't save">
          Check your connection and try again.
        </Notice>
      </section>

      <section className={styles.section}>
        <h3>Empty state and skeleton</h3>
        <EmptyState
          icon={<Inbox size={28} />}
          title="No sessions yet"
          description="Log your first study session to see progress here."
          action={<Button variant="primary">Log a session</Button>}
        />
        <div style={{ display: "grid", gap: "var(--sp-space-2)" }} aria-busy="true" aria-label="Loading">
          <Skeleton width="40%" height={18} />
          <Skeleton />
          <Skeleton width="80%" />
          <Skeleton height={8} radius="pill" />
        </div>
      </section>

      <section className={styles.section}>
        <h3>Dialog and disclosure</h3>
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Disclosure summary="Why this plan?">Based on 8 sessions over 4 weeks.</Disclosure>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="How did it go?"
          description="Calculus · 45 minutes"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Discard
              </Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>
                Log session
              </Button>
            </>
          }
        >
          <div style={{ display: "grid", gap: "var(--sp-space-3)" }}>
            <Field label="Focus (0–100)">
              <Input id={`${prefix}-focus`} defaultValue="70" inputMode="numeric" />
            </Field>
            <Field label="How much of the goal did you finish?">
              <Input id={`${prefix}-completion`} defaultValue="60" inputMode="numeric" />
            </Field>
          </div>
        </Dialog>
      </section>

      <section className={styles.section}>
        <h3>Navigation</h3>
        <div className={styles.row} style={{ alignItems: "start" }}>
          <nav className={styles.sidebar} aria-label={`Sidebar example (${theme})`}>
            <NavItem href="#" label="This week" icon={<LayoutDashboard size={18} />} active />
            <NavItem href="#" label="My courses" icon={<BookOpen size={18} />} />
            <NavItem href="#" label="Progress" icon={<ChartLine size={18} />} />
          </nav>
          <nav className={styles.tabbar} style={{ width: 320 }} aria-label={`Tab bar example (${theme})`}>
            <NavItem layout="tab" href="#" label="Week" icon={<LayoutDashboard size={20} />} active />
            <NavItem layout="tab" href="#" label="Courses" icon={<BookOpen size={20} />} />
            <NavItem layout="tab" href="#" label="Log" icon={<Timer size={20} />} />
            <NavItem layout="tab" href="#" label="Progress" icon={<ChartLine size={20} />} />
          </nav>
        </div>
      </section>
    </>
  );
}
