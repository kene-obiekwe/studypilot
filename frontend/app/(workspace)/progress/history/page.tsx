"use client";

import Link from "next/link";

import { Button, EmptyState, Notice, Skeleton } from "@/components/ui";

import { PlansList } from "../_lib/PlansList";
import { SessionsTable } from "../_lib/SessionsTable";
import styles from "../_lib/progress.module.css";
import { useProgress } from "../_lib/shared";
import { useSavedCourses } from "../_lib/useSavedCourses";

export default function ProgressHistoryPage() {
  const { plans, sessions, isLoading, error, refresh } = useProgress();
  const { colorStyle } = useSavedCourses();
  const loading = isLoading && sessions.length === 0 && plans.length === 0;

  return (
    <div className={styles.page}>
      {error && (
        <Notice tone="danger" title="Could not load your history">
          {error}{" "}
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            Try again
          </Button>
        </Notice>
      )}

      {loading && (
        <div className={styles.section} aria-busy="true" aria-label="Loading your history">
          <Skeleton height={40} />
          <Skeleton height={200} />
        </div>
      )}

      <section className={styles.section} aria-labelledby="sessions-title">
        <div className={styles.sectionHead}>
          <h2 id="sessions-title" className={styles.sectionTitle}>
            Sessions
          </h2>
          <p className={styles.muted}>{sessions.length} logged</p>
        </div>
        {sessions.length === 0 && !loading ? (
          <EmptyState
            title="No sessions yet"
            description="Sessions you log show up here, newest first."
            action={
              <Link href="/progress/log" className={styles.link}>
                Log a session
              </Link>
            }
          />
        ) : (
          sessions.length > 0 && <SessionsTable sessions={sessions} colorStyle={colorStyle} />
        )}
      </section>

      <section className={styles.section} aria-labelledby="plans-title">
        <div className={styles.sectionHead}>
          <h2 id="plans-title" className={styles.sectionTitle}>
            Plans
          </h2>
          <p className={styles.muted}>{plans.length} saved</p>
        </div>
        {plans.length === 0 && !loading ? (
          <p className={styles.muted}>
            No plans yet.{" "}
            <Link href="/planner" className={styles.link}>
              Generate one in the planner
            </Link>
          </p>
        ) : (
          plans.length > 0 && <PlansList plans={plans} colorStyle={colorStyle} />
        )}
      </section>
    </div>
  );
}
