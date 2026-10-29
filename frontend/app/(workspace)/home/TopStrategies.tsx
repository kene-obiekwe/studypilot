"use client";

import { useState } from "react";
import Link from "next/link";

import { Checkbox, Notice } from "@/components/ui";
import { sendStrategyFeedback, type CourseRecommendations, type StrategyFeedbackState } from "@/lib/api";
import type { CourseColor } from "@/lib/course-colors";
import { applyOptimistic, rollback, settle, shouldSend } from "@/lib/strategy-feedback";

import { pickTopStrategies, type TopStrategy } from "./top-strategies";
import styles from "./home.module.css";

/** "This week's top 3" as a compact checklist: ticking one marks it tried, as on /strategies. */
export function TopStrategies({
  courses,
  colorFor,
  now,
}: {
  courses: CourseRecommendations[];
  colorFor: (courseId: number) => CourseColor;
  now: Date;
}) {
  const top = pickTopStrategies(courses, now);
  return (
    <section aria-labelledby="top-heading" className={styles.section}>
      <div className={styles.stripHead}>
        <h2 id="top-heading" className={styles.sectionTitle}>
          This week&rsquo;s top 3
        </h2>
        <Link href="/strategies" className={styles.textLink}>
          See all strategies
        </Link>
      </div>
      {top.length === 0 ? (
        <p className={styles.muted}>No strategies yet. They appear once your courses have settings or logged sessions.</p>
      ) : (
        <ul className={styles.topList}>
          {top.map((item) => (
            <TopItem key={item.rec.shown_id} item={item} color={colorFor(item.course.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TopItem({ item, color }: { item: TopStrategy; color: CourseColor }) {
  const { course, rec } = item;
  const [feedback, setFeedback] = useState<StrategyFeedbackState>(rec.feedback);
  const [error, setError] = useState("");
  const id = `top-${rec.shown_id}`;

  const markTried = async () => {
    if (!shouldSend(feedback, "tried")) return;
    const before = feedback;
    setError("");
    setFeedback((current) => applyOptimistic(current, "tried"));
    try {
      const server = await sendStrategyFeedback(rec.shown_id, "tried");
      setFeedback((current) => settle(current, "tried", server));
    } catch (failure) {
      setFeedback((current) => rollback(current, "tried", before));
      setError(`Couldn't save that: ${(failure as Error).message}`);
    }
  };

  const meta = (
    <span className={styles.topMeta} style={color.style}>
      <span className={styles.dot} aria-hidden="true" />
      {course.name}
      {feedback.tried ? " · Marked as tried" : ` · ${rec.what}`}
    </span>
  );

  return (
    <li className={styles.topItem}>
      {feedback.tried ? (
        // Tried is one-way: a done state that stays focusable, as on /strategies.
        <Checkbox
          id={id}
          label={<span className={styles.done}>{rec.title} ✓</span>}
          hint={meta}
          aria-disabled="true"
          checked
          onChange={() => undefined}
        />
      ) : (
        <Checkbox id={id} label={rec.title} hint={meta} checked={false} onChange={() => void markTried()} />
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </li>
  );
}
