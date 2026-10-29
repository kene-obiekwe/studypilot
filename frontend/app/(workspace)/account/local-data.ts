import { ONBOARDING_DONE_PREFIX } from "@/lib/onboarding";
import { timerForUser, parseTimer } from "@/lib/timer";
import { clearTimer, getTimerSnapshot } from "@/lib/timer-store";

import { setCourseCollapsed } from "../strategies/collapsed-courses";

/**
 * Forget what this browser kept for a deleted account: its running timer, its onboarding flag and
 * which of its courses were collapsed on /strategies. Other accounts' entries and the theme stay.
 * Never throws: storage can be unavailable.
 */
export function clearLocalUserData(userId: number, courseIds: readonly number[]): void {
  if (timerForUser(parseTimer(getTimerSnapshot()), userId)) clearTimer();
  try {
    window.localStorage.removeItem(`${ONBOARDING_DONE_PREFIX}${userId}`);
  } catch {
    // Nothing was stored, or it can't be reached.
  }
  for (const id of courseIds) setCourseCollapsed(id, false);
}
