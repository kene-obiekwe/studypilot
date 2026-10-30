"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { Badge, Button, Checkbox, Disclosure, Notice } from "@/components/ui";
import {
  sendStrategyFeedback,
  type CourseRecommendation,
  type SavedPlanStatus,
  type StrategyFeedbackState,
  type StrategyFeedbackValue,
} from "@/lib/api";
import { REST_NOTE, applyOptimistic, rollback, settle, shouldSend } from "@/lib/strategy-feedback";

import styles from "./strategies.module.css";

/**
 * One strategy in a course's checklist, with optimistic "tried" and helpful / not helpful feedback.
 * The row stays compact: title, the "From your data" badge when the data chose it, and the
 * controls. What to do, why, the steps and the source sit behind one "Why and how" disclosure.
 * A helpful rating persists across weeks and is said in words. A Not helpful row stays until the
 * course is refreshed (after the plan is written or updated), so the rating can still be switched,
 * with a note that the strategy will rest. A saved rating reports the course's plan status upward,
 * so "Update plan" can appear without a reload.
 */
export function StrategyItem({
  rec,
  onPlanStatus,
}: {
  rec: CourseRecommendation;
  /** Called with the plan status the server returns after a successful rating (not for "Tried it"). */
  onPlanStatus?: (status: SavedPlanStatus | null) => void;
}) {
  const [feedback, setFeedback] = useState<StrategyFeedbackState>(rec.feedback);
  const [error, setError] = useState("");
  const titleId = `strategy-${rec.shown_id}-title`;

  const send = async (value: StrategyFeedbackValue) => {
    if (!shouldSend(feedback, value)) return;
    const before = feedback;
    setError("");
    setFeedback((current) => applyOptimistic(current, value));
    try {
      const server = await sendStrategyFeedback(rec.shown_id, value);
      setFeedback((current) => settle(current, value, server));
      if (value !== "tried") onPlanStatus?.(server.saved_plan);
    } catch (failure) {
      setFeedback((current) => rollback(current, value, before));
      setError(`Couldn't save that: ${(failure as Error).message}`);
    }
  };

  return (
    <li className={styles.item} aria-labelledby={titleId}>
      <div className={styles.itemHead}>
        <h3 id={titleId} className={styles.itemTitle}>
          {rec.title}
        </h3>
        {/* Only data-backed picks are marked; the rest come from the course settings or library. */}
        {rec.basis === "history" && <Badge tone="accent">From your data</Badge>}
        {feedback.rating === "helpful" && (
          <span className={styles.helpfulNote}>
            <ThumbsUp size={12} aria-hidden="true" />
            You found this helpful
          </span>
        )}
      </div>

      <Disclosure summary="Why and how" className={styles.details}>
        <div className={styles.detailsBody}>
          <p className={styles.what}>{rec.what}</p>
          <p className={styles.why}>{rec.why}</p>
          <ol className={styles.steps} aria-label="How">
            {rec.how.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className={styles.source}>
            Source: {rec.source.short}
            {rec.source.note && <> · {rec.source.note}</>}
          </p>
        </div>
      </Disclosure>

      <div className={styles.controls}>
        <TriedControl
          id={`strategy-${rec.shown_id}-tried`}
          tried={feedback.tried}
          title={rec.title}
          onTry={() => void send("tried")}
        />
        <div className={styles.rating} role="group" aria-label={`Was "${rec.title}" helpful?`}>
          <RatingButton active={feedback.rating === "helpful"} icon={<ThumbsUp size={14} />} onClick={() => void send("helpful")}>
            Helpful
          </RatingButton>
          <RatingButton
            active={feedback.rating === "not_helpful"}
            icon={<ThumbsDown size={14} />}
            onClick={() => void send("not_helpful")}
          >
            Not helpful
          </RatingButton>
        </div>
      </div>

      {/* Always mounted, so a screen reader announces the note when it appears. */}
      <p className={styles.restNote} role="status">
        {feedback.rating === "not_helpful" ? REST_NOTE : ""}
      </p>

      {error && (
        <div className={styles.error}>
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </li>
  );
}

/**
 * "Tried it" is one-way: the server has no "untry". Once set it shows a done state that stays a
 * focusable checkbox (checked, aria-disabled) with a visible "Marked as tried" hint.
 */
function TriedControl({ id, tried, title, onTry }: { id: string; tried: boolean; title: string; onTry: () => void }) {
  if (!tried) {
    return <Checkbox id={id} label="Tried it" aria-label={`Tried it: ${title}`} checked={false} onChange={onTry} />;
  }
  return (
    <Checkbox
      id={id}
      label={<span className={styles.done}>Tried ✓</span>}
      hint="Marked as tried"
      aria-label={`Tried it: ${title}`}
      aria-disabled="true"
      checked
      onChange={() => undefined}
    />
  );
}

function RatingButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={icon}
      aria-pressed={active}
      className={styles.ratingButton}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
