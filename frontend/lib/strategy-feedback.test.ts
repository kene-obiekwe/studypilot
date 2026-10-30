import { describe, expect, it } from "vitest";

import {
  REST_NOTE,
  applyOptimistic,
  fieldOf,
  restUntilLabel,
  restingLine,
  rollback,
  settle,
  shouldSend,
  withoutResting,
} from "./strategy-feedback";

const fresh = { rating: null, tried: false } as const;

describe("strategy feedback", () => {
  it("maps values to their field", () => {
    expect(fieldOf("tried")).toBe("tried");
    expect(fieldOf("helpful")).toBe("rating");
    expect(fieldOf("not_helpful")).toBe("rating");
  });

  it("sends only changes: tried once, and never the active rating again", () => {
    expect(shouldSend(fresh, "tried")).toBe(true);
    expect(shouldSend({ ...fresh, tried: true }, "tried")).toBe(false);
    expect(shouldSend(fresh, "helpful")).toBe(true);
    expect(shouldSend({ ...fresh, rating: "helpful" }, "helpful")).toBe(false);
    expect(shouldSend({ ...fresh, rating: "helpful" }, "not_helpful")).toBe(true);
  });

  it("applies the change optimistically", () => {
    expect(applyOptimistic(fresh, "tried")).toEqual({ rating: null, tried: true });
    expect(applyOptimistic({ rating: "helpful", tried: true }, "not_helpful")).toEqual({ rating: "not_helpful", tried: true });
  });

  it("settles only the field the request changed", () => {
    // A rating answer arrives while "tried" is still optimistic and unconfirmed by this response.
    const shown = { rating: "helpful" as const, tried: true };
    expect(settle(shown, "helpful", { rating: "helpful", tried: false })).toEqual({ rating: "helpful", tried: true });
    expect(settle(shown, "tried", { rating: null, tried: true })).toEqual({ rating: "helpful", tried: true });
  });

  it("rolls back only the failed request's field", () => {
    const before = { rating: null, tried: false };
    const shown = { rating: "not_helpful" as const, tried: true };
    expect(rollback(shown, "not_helpful", before)).toEqual({ rating: null, tried: true });
    expect(rollback(shown, "tried", before)).toEqual({ rating: "not_helpful", tried: false });
  });
});

describe("resting helpers", () => {
  it("counts what is resting", () => {
    expect(restingLine(1)).toBe("1 strategy resting");
    expect(restingLine(2)).toBe("2 strategies resting");
    expect(restingLine(0)).toBe("0 strategies resting");
  });

  it("writes the day a strategy returns in UK order", () => {
    expect(restUntilLabel("2026-11-18")).toBe("18 Nov 2026");
    expect(restUntilLabel("2026-01-05")).toBe("5 Jan 2026");
    expect(restUntilLabel("not a date")).toBe("not a date");
  });

  it("removes one strategy for the optimistic Show again, without touching the original", () => {
    const resting = [
      { strategy_id: "a", title: "A", until: "2026-11-18" },
      { strategy_id: "b", title: "B", until: "2026-11-19" },
    ];
    expect(withoutResting(resting, "a")).toEqual([resting[1]]);
    expect(withoutResting(resting, "zzz")).toEqual(resting);
    expect(resting).toHaveLength(2);
  });

  it("tells the user a Not helpful strategy rests for four weeks", () => {
    expect(REST_NOTE).toBe("This strategy will rest for 4 weeks.");
  });
});
