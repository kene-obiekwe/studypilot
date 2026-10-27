/** Guided onboarding: which step to open at, whether the user has finished or skipped it, and where verification leads. */

import { safeNextPath } from "./auth-flow";

export const ONBOARDING_PATH = "/onboarding";
export const ONBOARDING_DONE_PREFIX = "sp-onboarding-done:";

export type OnboardingStep = 1 | 2 | 3;

export const ONBOARDING_STEPS: ReadonlyArray<{ step: OnboardingStep; label: string }> = [
  { step: 1, label: "Courses" },
  { step: 2, label: "Plan" },
  { step: 3, label: "First session" },
];

/** Where to open: no courses -> 1; courses but no plan for this week -> 2; otherwise 3. */
export function resolveStep(input: { courseCount: number; hasPlanThisWeek: boolean }): OnboardingStep {
  if (input.courseCount <= 0) return 1;
  return input.hasPlanThisWeek ? 3 : 2;
}

/** After a successful email verification: a safe `next` wins, otherwise the user starts onboarding. */
export function postVerifyDestination(next: string | null | undefined): string {
  return safeNextPath(next, "") || ONBOARDING_PATH;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked site data can make the accessor itself throw
  }
}

const doneKey = (userId: number) => `${ONBOARDING_DONE_PREFIX}${userId}`;

/** True when this user skipped or finished onboarding in this browser. Storage trouble reads as "not yet". */
export function isOnboardingDone(userId: number | null, store: Store | null = defaultStore()): boolean {
  if (userId === null || !store) return false;
  try {
    return store.getItem(doneKey(userId)) === "1";
  } catch {
    return false;
  }
}

/** Remembers that this user skipped or finished onboarding. Never throws. */
export function markOnboardingDone(userId: number | null, store: Store | null = defaultStore()): void {
  if (userId === null || !store) return;
  try {
    store.setItem(doneKey(userId), "1");
  } catch {
    // The flag is only a convenience; without storage the user simply sees onboarding offered again.
  }
}
