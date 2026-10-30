/**
 * Optimistic feedback on one shown strategy. "tried" and the helpful/not-helpful rating are
 * separate fields on the server, so each request settles or rolls back only its own field:
 * a "tried" request and a rating request in flight at once never overwrite each other.
 */

import type { RestingStrategy, StrategyFeedbackState, StrategyFeedbackValue } from "./api";

/** Shown on a row marked Not helpful: the server rests the strategy for 28 days from the next reload. */
export const REST_NOTE = "This strategy will rest for 4 weeks.";
export const REST_EXPLANATION =
  "Some techniques feel hard while they work, testing yourself especially, so it's worth giving them another go.";

export type FeedbackField = "tried" | "rating";

export function fieldOf(value: StrategyFeedbackValue): FeedbackField {
  return value === "tried" ? "tried" : "rating";
}

/** False when the click changes nothing: already tried, or the rating is already this value. */
export function shouldSend(state: StrategyFeedbackState, value: StrategyFeedbackValue): boolean {
  return value === "tried" ? !state.tried : state.rating !== value;
}

/** The state to show while the request is in flight. */
export function applyOptimistic(state: StrategyFeedbackState, value: StrategyFeedbackValue): StrategyFeedbackState {
  return value === "tried" ? { ...state, tried: true } : { ...state, rating: value };
}

/** Take the server's word, but only for the field this request changed. */
export function settle(
  state: StrategyFeedbackState,
  value: StrategyFeedbackValue,
  server: StrategyFeedbackState,
): StrategyFeedbackState {
  return fieldOf(value) === "tried" ? { ...state, tried: server.tried } : { ...state, rating: server.rating };
}

/** Undo the optimistic change of this request's field only. */
export function rollback(
  state: StrategyFeedbackState,
  value: StrategyFeedbackValue,
  before: StrategyFeedbackState,
): StrategyFeedbackState {
  return fieldOf(value) === "tried" ? { ...state, tried: before.tried } : { ...state, rating: before.rating };
}

/** "1 strategy resting" / "3 strategies resting". */
export function restingLine(count: number): string {
  return `${count} ${count === 1 ? "strategy" : "strategies"} resting`;
}

/** "18 Nov 2026" from an ISO date: UK order whatever the browser's locale, like the rest of the app. */
export function restUntilLabel(until: string): string {
  const date = new Date(`${until}T00:00:00`);
  return Number.isNaN(date.getTime()) ? until : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The resting list without one strategy: the optimistic step of "Show again". */
export function withoutResting(resting: RestingStrategy[], strategyId: string): RestingStrategy[] {
  return resting.filter((entry) => entry.strategy_id !== strategyId);
}
