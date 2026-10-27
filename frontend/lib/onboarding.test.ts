import { describe, expect, it } from "vitest";

import { isOnboardingDone, markOnboardingDone, ONBOARDING_PATH, postVerifyDestination, resolveStep } from "./onboarding";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
};

describe("resolveStep", () => {
  it("opens at courses when there are none, whatever the plan says", () => {
    expect(resolveStep({ courseCount: 0, hasPlanThisWeek: false })).toBe(1);
    expect(resolveStep({ courseCount: 0, hasPlanThisWeek: true })).toBe(1);
  });

  it("opens at the plan when there are courses but no plan this week", () => {
    expect(resolveStep({ courseCount: 2, hasPlanThisWeek: false })).toBe(2);
  });

  it("opens at the first session when courses and this week's plan exist", () => {
    expect(resolveStep({ courseCount: 1, hasPlanThisWeek: true })).toBe(3);
  });
});

describe("the skipped or finished flag", () => {
  it("is false until marked, and stays per user", () => {
    const store = memoryStore();
    expect(isOnboardingDone(1, store)).toBe(false);
    markOnboardingDone(1, store);
    expect(isOnboardingDone(1, store)).toBe(true);
    expect(isOnboardingDone(2, store)).toBe(false);
  });

  it("does nothing for an unknown user", () => {
    const store = memoryStore();
    markOnboardingDone(null, store);
    expect(store.data.size).toBe(0);
    expect(isOnboardingDone(null, store)).toBe(false);
  });

  it("tolerates storage that is missing or throws", () => {
    expect(isOnboardingDone(1, null)).toBe(false);
    expect(() => markOnboardingDone(1, null)).not.toThrow();
    expect(isOnboardingDone(1, broken)).toBe(false);
    expect(() => markOnboardingDone(1, broken)).not.toThrow();
  });

  it("ignores any stored value other than the one it writes", () => {
    const store = memoryStore();
    store.setItem("sp-onboarding-done:1", "true");
    expect(isOnboardingDone(1, store)).toBe(false);
  });
});

describe("postVerifyDestination", () => {
  it("starts onboarding when there is no next", () => {
    expect(postVerifyDestination(null)).toBe(ONBOARDING_PATH);
    expect(postVerifyDestination(undefined)).toBe(ONBOARDING_PATH);
    expect(postVerifyDestination("")).toBe(ONBOARDING_PATH);
  });

  it("follows a safe next, query included", () => {
    expect(postVerifyDestination("/planner")).toBe("/planner");
    expect(postVerifyDestination("/progress/log?course=3")).toBe("/progress/log?course=3");
  });

  it("starts onboarding for an unsafe next or an auth page", () => {
    expect(postVerifyDestination("//evil.example")).toBe(ONBOARDING_PATH);
    expect(postVerifyDestination("https://evil.example")).toBe(ONBOARDING_PATH);
    expect(postVerifyDestination("/\\evil.example")).toBe(ONBOARDING_PATH);
    expect(postVerifyDestination("/sign-in")).toBe(ONBOARDING_PATH);
    expect(postVerifyDestination("/verify-email?x=1")).toBe(ONBOARDING_PATH);
  });
});
