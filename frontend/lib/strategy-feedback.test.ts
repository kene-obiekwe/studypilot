import { describe, expect, it } from "vitest";

import { applyOptimistic, fieldOf, rollback, settle, shouldSend } from "./strategy-feedback";

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
