import type { CSSProperties } from "react";
import { Check } from "lucide-react";

import { Badge, Button, Card, Notice, ProgressBar } from "@/components/ui";
import type { WeeklyPlan } from "@/lib/api";
import { formatHours, planEntries, type DaysLeft } from "@/lib/week";

import { dayLabel, hoursText, planTotal, updatesText, type WeekCard } from "./plan-model";
import styles from "./planner.module.css";

type ColorStyle = (courseName: string) => CSSProperties | undefined;

type ThisWeekCardProps = {
  card: WeekCard;
  days: DaysLeft;
  colorStyle: ColorStyle;
  /** Opens the update form; absent while it is open. */
  onUpdate?: () => void;
};

/** "This week's plan": the week's total, then planned / logged / left per course. */
export function ThisWeekCard({ card, days, colorStyle, onUpdate }: ThisWeekCardProps) {
  const progress = `${formatHours(card.logged)} of ${hoursText(card.total)}`;
  const updates = updatesText(card);
  return (
    <Card as="section" className={styles.card} aria-labelledby="this-week-title">
      <div className={styles.cardHead}>
        <div className={styles.cardTitleBlock}>
          <h2 id="this-week-title" className={styles.sectionTitle}>
            This week&apos;s plan
          </h2>
          <p className={styles.cardSummary}>
            <span className={styles.cardHours}>{progress}</span>
            <span aria-hidden="true"> · </span>
            <span className={styles.mutedInline}>
              {days.count} {days.count === 1 ? "day" : "days"} left ({days.label})
            </span>
          </p>
        </div>
        {onUpdate && <Button onClick={onUpdate}>Update this week&apos;s plan</Button>}
      </div>

      <ProgressBar label="Hours this week" value={card.logged} max={card.total} valueText={progress} hideHeader />

      {card.complete && (
        <Notice tone="success" title="Week complete.">
          You&apos;ve done the {hoursText(card.total)} you planned. Anything more is a bonus.
        </Notice>
      )}

      {card.rows.length > 0 ? (
        <ul className={styles.planRows}>
          {card.rows.map((row) => (
            <li key={row.name} className={styles.planRow} data-status={row.status}>
              <div className={styles.planRowHead}>
                <p className={styles.resultName}>
                  <span className={styles.dot} style={colorStyle(row.name)} aria-hidden="true" />
                  {row.name}
                </p>
                <RowHours row={row} />
              </div>
              {row.planned > 0 && (
                <div style={colorStyle(row.name)}>
                  <ProgressBar
                    label={`${row.name} this week`}
                    value={row.logged}
                    max={row.planned}
                    valueText={`${formatHours(row.logged)} of ${hoursText(row.planned)}`}
                    hideHeader
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>No courses are left in this week&apos;s plan. Update it to add some.</p>
      )}

      {card.removed.length > 0 && (
        <p className={styles.muted}>
          No longer in this week&apos;s plan:{" "}
          {card.removed.map((item, index) => (
            <span key={item.name}>
              {index > 0 && ", "}
              {item.name} · {hoursText(item.logged)} logged (not counted)
            </span>
          ))}
          . Sessions stay in your history.
        </p>
      )}

      {updates && <p className={styles.muted}>{updates}</p>}
    </Card>
  );
}

function RowHours({ row }: { row: WeekCard["rows"][number] }) {
  if (row.status === "done") {
    return (
      <p className={styles.rowHours}>
        <Badge tone="success" icon={<Check size={14} />}>
          Done for this week
        </Badge>
        <span>
          {formatHours(row.logged)} of {hoursText(row.planned)}
        </span>
      </p>
    );
  }
  if (row.status === "none_planned") {
    return <p className={styles.rowHours}>No hours planned this week</p>;
  }
  return (
    <p className={styles.rowHours}>
      <span className={styles.rowHoursMain}>
        {formatHours(row.logged)} of {hoursText(row.planned)}
      </span>
      {" · "}
      <span>{hoursText(row.remaining)} left</span>
    </p>
  );
}

type NextWeekCardProps = {
  plan: WeeklyPlan;
  colorStyle: ColorStyle;
  /** Opens the form on next week's plan; absent while it is open. */
  onEdit?: () => void;
};

/** "Next week's plan · starts Mon 2 Nov · 12 h", made ahead on a Saturday or Sunday. */
export function NextWeekCard({ plan, colorStyle, onEdit }: NextWeekCardProps) {
  const entries = planEntries(plan);
  return (
    <Card as="section" className={styles.card} aria-labelledby="next-week-title">
      <div className={styles.cardHead}>
        <div className={styles.cardTitleBlock}>
          <h2 id="next-week-title" className={styles.sectionTitle}>
            Next week&apos;s plan
          </h2>
          <p className={styles.cardSummary}>
            <span className={styles.mutedInline}>starts {dayLabel(plan.week_start)}</span>
            <span aria-hidden="true"> · </span>
            <span className={styles.cardHours}>{hoursText(planTotal(plan))}</span>
          </p>
        </div>
        {onEdit && (
          <Button onClick={onEdit} aria-label="Edit next week's plan">
            Edit
          </Button>
        )}
      </div>
      <ul className={styles.compactRows}>
        {entries.map((entry) => (
          <li key={entry.name}>
            <span className={styles.dot} style={colorStyle(entry.name)} aria-hidden="true" />
            <span className={styles.compactName}>{entry.name}</span>
            <span className={styles.compactHours}>{hoursText(entry.plannedHours)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
