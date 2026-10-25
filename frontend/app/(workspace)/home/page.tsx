"use client";

import { Suspense } from "react";
import Link from "next/link";
import { CalendarCheck, Timer } from "lucide-react";

import { PageAction, useShellData, WeekMeterSkeleton } from "@/components/app-shell";
import styles from "@/components/app-shell/shell.module.css";
import { EmptyState, ProgressBar, Stat } from "@/components/ui";
import { formatHours, meterText } from "@/lib/week";

/** "This week". The full home (course cards, forecasts, top strategies) arrives in 5.3e. */
export default function HomePage() {
  return (
    <div className={styles.page}>
      <PageAction>
        <Link href="/progress/log" className={styles.linkButton}>
          <Timer size={16} aria-hidden="true" />
          Log a session
        </Link>
      </PageAction>

      <section aria-labelledby="week-heading">
        <h2 id="week-heading" className={styles.srOnly}>
          Hours this week
        </h2>
        <Suspense fallback={<WeekMeterSkeleton />}>
          <WeekSummary />
        </Suspense>
      </section>

      <EmptyState
        icon={<CalendarCheck size={28} />}
        title="Your week at a glance is on its way"
        description="Course cards with forecasts, exam countdowns and this week's top strategies will appear here."
        action={
          <Link href="/planner" className={styles.linkButton}>
            Open the planner
          </Link>
        }
      />
    </div>
  );
}

function WeekSummary() {
  const { week } = useShellData();
  if (!week) {
    return <Stat label="This week" value="—" hint="Hours are unavailable right now." />;
  }
  const hasPlan = week.plannedHours > 0;
  return (
    <div style={{ display: "grid", gap: "var(--sp-space-3)", maxWidth: 520 }}>
      <Stat
        label="This week"
        value={formatHours(week.loggedHours)}
        unit={hasPlan ? `of ${formatHours(week.plannedHours)} h` : "h logged"}
        hint={hasPlan ? undefined : "No plan for this week yet."}
      />
      {hasPlan && (
        <ProgressBar
          label="Logged against this week's plan"
          value={week.loggedHours}
          max={week.plannedHours}
          valueText={meterText(week)}
          hideHeader
        />
      )}
    </div>
  );
}
