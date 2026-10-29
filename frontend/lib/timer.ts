/**
 * Study timer: the pure parts (state shape, parsing, elapsed-time maths, defaults). The browser
 * store that persists it lives in timer-store.ts.
 *
 * Elapsed time is always `now - startedAt`, never a counter, so a refresh, a hidden tab or a
 * sleeping laptop can't make it drift.
 */

import type { SessionHistoryItem } from "./api";
import { currentPlanThisWeek, planEntries, startOfLocalWeek, type PlanLike } from "./week";

export type TimerState = {
  /** The signed-in user who started it; another account in the same browser ignores it. */
  userId: number | null;
  courseId: number;
  courseName: string;
  /** Epoch milliseconds. */
  startedAt: number;
  plannedMinutes: number;
};

export const TIMER_STORAGE_KEY = "sp-timer";

export const PLANNED_MIN = 5;
export const PLANNED_MAX = 240;
/** The planner's focus block, used when this week's plan doesn't say. */
export const DEFAULT_BLOCK_MINUTES = 50;
/** Never suggest less than this, even when the week's allocation is nearly used up. */
export const MIN_SUGGESTED_MINUTES = 15;
/** The most a single logged session may claim (one day). */
export const MAX_ACTUAL_MINUTES = 1440;
/** A timer left running overnight shouldn't pre-fill a 14-hour session. */
export const MAX_PREFILL_MINUTES = 720;

/** Focus: five steps from 0.2 to 1.0. Completion: 0, 25, 50, 75 and 100%. */
export const FOCUS_STEPS = [0.2, 0.4, 0.6, 0.8, 1] as const;
export const COMPLETION_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The stored timer, or null when the value is missing, corrupt or from an older shape. */
export function parseTimer(raw: string | null): TimerState | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const userId = record.userId === null ? null : record.userId;
  if (
    (userId !== null && !isFiniteNumber(userId)) ||
    !isFiniteNumber(record.courseId) ||
    typeof record.courseName !== "string" ||
    record.courseName.trim() === "" ||
    !isFiniteNumber(record.startedAt) ||
    !isFiniteNumber(record.plannedMinutes)
  ) {
    return null;
  }
  return {
    userId,
    courseId: record.courseId,
    courseName: record.courseName,
    startedAt: record.startedAt,
    plannedMinutes: clampPlanned(record.plannedMinutes),
  };
}

export function serializeTimer(state: TimerState): string {
  return JSON.stringify(state);
}

/** The timer if it belongs to this user. With the user unknown (getMe failed) it is shown anyway. */
export function timerForUser(state: TimerState | null, userId: number | null): TimerState | null {
  if (!state) return null;
  if (userId === null || state.userId === null) return state;
  return state.userId === userId ? state : null;
}

/** Milliseconds since the start; 0 if the clock says it hasn't started yet. */
export function elapsedMs(state: Pick<TimerState, "startedAt">, now: number): number {
  return Math.max(0, now - state.startedAt);
}

/** "04:09" under an hour, then "1:02:09". */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** "4 minutes", "1 hour 2 minutes": the spoken form for screen readers. */
export function describeElapsed(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (hours === 0) return part(minutes, "minute");
  return minutes === 0 ? part(hours, "hour") : `${part(hours, "hour")} ${part(minutes, "minute")}`;
}

/** Actual minutes to pre-fill when stopping: rounded, at least 1, capped (and flagged) at 12 hours. */
export function prefillActualMinutes(ms: number): { minutes: number; capped: boolean } {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return minutes > MAX_PREFILL_MINUTES ? { minutes: MAX_PREFILL_MINUTES, capped: true } : { minutes, capped: false };
}

export function clampPlanned(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_BLOCK_MINUTES;
  return Math.min(PLANNED_MAX, Math.max(PLANNED_MIN, Math.round(minutes)));
}

const sameCourse = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The planned length suggested when starting a timer for a course:
 * 1. Start from the session length of this week's plan for the course (its focus block),
 *    or 50 minutes when the course isn't in this week's plan.
 * 2. Work out what is left: in the plan, its planned hours minus what is logged for it this week
 *    (live, so it follows each session); not in the plan, the course's own weekly target minus
 *    the same. If less than a block is left, suggest the remainder instead, but never under 15
 *    minutes. With nothing left (the course is done for the week) or no target at all, keep the block.
 * 3. Round to 5 minutes and keep within 5 to 240.
 */
export function defaultPlannedMinutes(input: {
  courseName: string;
  weeklyTargetHours?: number | null;
  plans: readonly PlanLike[];
  sessions: readonly SessionHistoryItem[];
  now: Date;
}): number {
  const { courseName, weeklyTargetHours, plans, sessions, now } = input;
  const entry = planEntries(currentPlanThisWeek(plans, now)).find((item) => sameCourse(item.name, courseName));

  const block = entry?.focusBlockMinutes ?? DEFAULT_BLOCK_MINUTES;

  // A course in the plan has its planned hours (0 means nothing more to plan); otherwise fall back to its target.
  const weeklyHours = entry ? entry.plannedHours : Number(weeklyTargetHours ?? 0);
  let suggested = block;
  if (Number.isFinite(weeklyHours) && weeklyHours > 0) {
    const from = startOfLocalWeek(now).getTime();
    const logged = sessions.reduce((sum, session) => {
      const at = Date.parse(session.created_at);
      const actual = Number(session.actual_minutes);
      return sameCourse(session.course_name, courseName) && at >= from && at <= now.getTime() && actual > 0 ? sum + actual : sum;
    }, 0);
    const remaining = weeklyHours * 60 - logged;
    if (remaining > 0 && remaining < block) {
      suggested = Math.max(MIN_SUGGESTED_MINUTES, remaining);
    }
  }
  return clampPlanned(Math.round(suggested / 5) * 5);
}
