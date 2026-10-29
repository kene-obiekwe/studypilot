/**
 * Optimistic feedback on one shown strategy. "tried" and the helpful/not-helpful rating are
 * separate fields on the server, so each request settles or rolls back only its own field:
 * a "tried" request and a rating request in flight at once never overwrite each other.
 */

import type { StrategyFeedbackState, StrategyFeedbackValue } from "./api";

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
