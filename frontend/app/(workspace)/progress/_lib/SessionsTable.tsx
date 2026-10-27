"use client";

import { useId, useMemo, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { Button, Select } from "@/components/ui";
import type { SessionHistoryItem } from "@/lib/api";

import {
  ariaSort,
  DEFAULT_SORT,
  nextSort,
  percentText,
  shortDate,
  SORT_KEYS,
  SORT_LABELS,
  sortSessions,
  startSort,
  type SortKey,
  type SortState,
} from "./history-model";
import styles from "./progress.module.css";
import { useShowMore } from "./use-show-more";

export const SESSIONS_PAGE_SIZE = 20;

type SessionsTableProps = {
  sessions: ReadonlyArray<SessionHistoryItem>;
  /** The colour variables for a course name, or undefined for a neutral dot. */
  colorStyle?: (courseName: string) => CSSProperties | undefined;
  pageSize?: number;
};

function SortIcon({ state, columnKey }: { state: SortState; columnKey: SortKey }) {
  if (state.key !== columnKey) return <ChevronsUpDown size={14} className={styles.sortIcon} aria-hidden="true" />;
  return state.direction === "asc" ? (
    <ArrowUp size={14} className={styles.sortIcon} aria-hidden="true" />
  ) : (
    <ArrowDown size={14} className={styles.sortIcon} aria-hidden="true" />
  );
}

/**
 * Logged sessions as a sortable table. Click a column header to sort (the header carries
 * aria-sort); on phones the headers are hidden, the rows stack, and a sort control above the list
 * does the same job.
 */
export function SessionsTable({ sessions, colorStyle, pageSize = SESSIONS_PAGE_SIZE }: SessionsTableProps) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const { visible, done, showMore, statusRef } = useShowMore(sessions.length, pageSize);
  const sortSelectId = useId();

  const sorted = useMemo(() => sortSessions(sessions, sort), [sessions, sort]);
  const shown = sorted.slice(0, visible);
  const direction = sort.direction === "asc" ? "ascending" : "descending";

  return (
    <div className={styles.sessions}>
      <div className={styles.sortBar}>
        <label htmlFor={sortSelectId} className={styles.srOnly}>
          Sort sessions by
        </label>
        <Select
          id={sortSelectId}
          value={sort.key}
          onChange={(event) => setSort(startSort(event.target.value as SortKey))}
        >
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          aria-label={`Sorted ${direction}. Reverse the order`}
          onClick={() => setSort({ key: sort.key, direction: sort.direction === "asc" ? "desc" : "asc" })}
        >
          {sort.direction === "asc" ? "Lowest first" : "Highest first"}
        </Button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>Logged sessions, sorted by {SORT_LABELS[sort.key].toLowerCase()} ({direction})</caption>
          <thead>
            <tr>
              {SORT_KEYS.map((key) => (
                <th key={key} scope="col" aria-sort={ariaSort(sort, key)}>
                  <button type="button" className={styles.sortButton} onClick={() => setSort((current) => nextSort(current, key))}>
                    {SORT_LABELS[key]}
                    <SortIcon state={sort} columnKey={key} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.id}>
                <td data-label="Date">{shortDate(item.created_at)}</td>
                <td data-label="Course">
                  <span className={styles.courseCell}>
                    <span className={styles.dot} style={colorStyle?.(item.course_name)} aria-hidden="true" />
                    {item.course_name}
                  </span>
                </td>
                <td data-label="Planned">{item.planned_minutes} min</td>
                <td data-label="Actual">{item.actual_minutes} min</td>
                <td data-label="Adherence">{percentText(item.adherence_score)}</td>
                <td data-label="Focus">{percentText(item.focus_score)}</td>
                <td data-label="Forecast">{percentText(item.predicted_adherence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.more}>
        <p ref={statusRef} tabIndex={-1} className={`${styles.muted} ${styles.moreStatus}`} role="status">
          Showing {shown.length} of {sorted.length} sessions
        </p>
        {!done && <Button onClick={showMore}>Show more</Button>}
      </div>
    </div>
  );
}
