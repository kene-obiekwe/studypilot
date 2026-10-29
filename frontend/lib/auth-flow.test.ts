import { describe, expect, it } from "vitest";

import {
  authLink,
  CODE_LENGTH,
  DEFAULT_AFTER_SIGN_IN,
  resendReadyAt,
  resendSecondsLeft,
  RESEND_COOLDOWN_SECONDS,
  safeNextPath,
  sanitizeCode,
} from "./auth-flow";

describe("safeNextPath", () => {
  it("falls back to /home when there is no next", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath(undefined)).toBe("/home");
    expect(safeNextPath("")).toBe("/home");
  });

  it("keeps same-origin paths, including query and hash", () => {
    expect(safeNextPath("/planner")).toBe("/planner");
    expect(safeNextPath("/progress/history?page=2#top")).toBe("/progress/history?page=2#top");
  });

  it("rejects anything that could leave the site", () => {
    for (const next of [
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "/path\\..\\evil",
      "https://evil.example",
      "http://evil.example/path",
      "javascript:alert(1)",
      "evil.example",
      "planner",
    ]) {
      expect(safeNextPath(next), JSON.stringify(next)).toBe("/home");
    }
  });

  it("never lands back on an auth screen", () => {
    for (const next of ["/auth", "/auth?next=%2Fplanner", "/sign-in", "/sign-up?x=1", "/verify-email", "/forgot-password"]) {
      expect(safeNextPath(next), next).toBe("/home");
    }
    expect(safeNextPath("/authors")).toBe("/authors");
  });

  it("uses a custom fallback", () => {
    expect(safeNextPath("//evil", "/overview")).toBe("/overview");
  });
});

describe("sanitizeCode", () => {
  it("strips everything that is not a digit", () => {
    expect(sanitizeCode("12a3b4")).toBe("1234");
    expect(sanitizeCode("abc")).toBe("");
    expect(sanitizeCode("")).toBe("");
  });

  it("keeps at most six digits", () => {
    expect(CODE_LENGTH).toBe(6);
    expect(sanitizeCode("1234567890")).toBe("123456");
  });

  it("handles a pasted code with spaces, dashes or a trailing newline", () => {
    expect(sanitizeCode("123 456")).toBe("123456");
    expect(sanitizeCode("123-456")).toBe("123456");
    expect(sanitizeCode("  654321\n")).toBe("654321");
  });

  it("handles non-ASCII digits and punctuation", () => {
    expect(sanitizeCode("１２３456")).toBe("456");
    expect(sanitizeCode("(12) 34.56")).toBe("123456");
  });
});

describe("resend countdown", () => {
  it("starts at the full cooldown", () => {
    const now = 1_000_000;
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(resendSecondsLeft(resendReadyAt(now), now)).toBe(60);
  });

  it("counts down in whole seconds, rounding up", () => {
    const readyAt = resendReadyAt(0);
    expect(resendSecondsLeft(readyAt, 1)).toBe(60);
    expect(resendSecondsLeft(readyAt, 999)).toBe(60);
    expect(resendSecondsLeft(readyAt, 1_000)).toBe(59);
    expect(resendSecondsLeft(readyAt, 30_500)).toBe(30);
    expect(resendSecondsLeft(readyAt, 59_999)).toBe(1);
  });

  it("reaches zero at the deadline and never goes negative", () => {
    const readyAt = resendReadyAt(0);
    expect(resendSecondsLeft(readyAt, 60_000)).toBe(0);
    expect(resendSecondsLeft(readyAt, 120_000)).toBe(0);
  });

  it("accepts a custom cooldown", () => {
    expect(resendSecondsLeft(resendReadyAt(0, 10), 0)).toBe(10);
  });
});

describe("authLink", () => {
  it("returns the bare path when there is nothing to carry", () => {
    expect(authLink("/sign-up")).toBe("/sign-up");
    expect(authLink("/sign-up", { next: null, email: "" })).toBe("/sign-up");
  });

  it("carries next, email and the sent flag, encoded", () => {
    expect(authLink("/verify-email", { email: "a+b@example.com", sent: true, next: "/planner?w=1" })).toBe(
      "/verify-email?email=a%2Bb%40example.com&sent=1&next=%2Fplanner%3Fw%3D1",
    );
  });
});
