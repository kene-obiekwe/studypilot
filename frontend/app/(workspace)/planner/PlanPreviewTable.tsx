import type { CSSProperties } from "react";

import type { PlanPreview } from "@/lib/api";
import { formatHours, type PlanLike } from "@/lib/week";

import { clampedText, hoursText, newTotalText, pastShareText, previewModel } from "./plan-model";
import styles from "./planner.module.css";

type PlanPreviewTableProps = {
  preview: PlanPreview;
  /** The plan being updated, or null for a first plan. */
  base: PlanLike | null;
  colorStyle: (courseName: string) => CSSProperties | undefined;
};

/** Course · Done · New plan · Left this week, with the new total and any course past its share. */
export function PlanPreviewTable({ preview, base, colorStyle }: PlanPreviewTableProps) {
  const model = previewModel(preview, base);
  return (
    <div className={styles.section}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>The new split, per course</caption>
          <thead>
            <tr>
              <th scope="col">Course</th>
              <th scope="col">Done</th>
              <th scope="col">New plan</th>
              <th scope="col">Left this week</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">
                  <span className={styles.tableCourse}>
                    <span className={styles.dot} style={colorStyle(row.name)} aria-hidden="true" />
                    <span>
                      {row.name}
                      {row.adjustment && <span className={styles.tableNote}>{row.adjustment}</span>}
                    </span>
                  </span>
                </th>
                <td>{row.done > 0 ? hoursText(row.done) : "0"}</td>
                <td>{hoursText(row.planned)}</td>
                <td>
                  {row.left > 0 ? `${hoursText(row.left)} left` : row.done > 0 ? "Done for this week" : "0 h"}
                  {row.isNew && " (new)"}
                </td>
              </tr>
            ))}
            {model.removed.map((item) => (
              <tr key={`removed-${item.name}`} className={styles.removedRow}>
                <th scope="row">
                  <span className={styles.tableCourse}>
                    <span className={styles.dot} style={colorStyle(item.name)} aria-hidden="true" />
                    <span>{item.name}</span>
                  </span>
                </th>
                <td>removed</td>
                <td colSpan={2}>{formatHours(item.logged)} h not counted</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.previewTotal}>{newTotalText(model)}</p>
      {model.clamped && <p className={styles.muted}>{clampedText(model.counted)}</p>}
      {model.pastShare.length > 0 && <p className={styles.muted}>{pastShareText(model.pastShare)}</p>}
      {model.more === 0 && !model.clamped && (
        <p className={styles.muted}>With no more hours, the week&apos;s plan is the {hoursText(model.counted)} already done.</p>
      )}
    </div>
  );
}
