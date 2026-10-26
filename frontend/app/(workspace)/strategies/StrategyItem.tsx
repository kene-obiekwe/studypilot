"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { Badge, Button, Checkbox, Disclosure, Notice } from "@/components/ui";
import {
  sendStrategyFeedback,
  type CourseRecommendation,
  type StrategyFeedbackState,
  type StrategyFeedbackValue,
} from "@/lib/api";
import { applyOptimistic, rollback, settle, shouldSend } from "@/lib/strategy-feedback";

import styles from "./strategies.module.css";

/** One strategy in a course's checklist, with optimistic "tried" and helpful / not helpful feedback. */
export function StrategyItem({ rec }: { rec: CourseRecommendation }) {
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
    } catch (failure) {
      setFeedback((current) => rollback(current, value, before));
      setError(`Couldn't save that: ${(failure as Error).message}`);
    }
  };

  return (
    <li className={styles.item} aria-labelledby={titleId}>
      <div className={styles.itemHead}>
        <div>
          <h3 id={titleId} className={styles.itemTitle}>
            {rec.title}
          </h3>
          <p className={styles.what}>{rec.what}</p>
        </div>
        <Badge tone={rec.basis === "history" ? "accent" : "neutral"}>
          {rec.basis === "history" ? "From your data" : "From course settings"}
        </Badge>
      </div>

      <p className={styles.why}>{rec.why}</p>

      <Disclosure summary="How">
        <ol className={styles.steps}>
          {rec.how.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Disclosure>

      <p className={styles.source}>
        Source: {rec.source.short}
        {rec.source.note && <> · {rec.source.note}</>}
      </p>

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

      {error && <Notice tone="danger">{error}</Notice>}
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
