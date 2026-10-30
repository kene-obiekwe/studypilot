/** Days until an exam, for the "Exam in N days" badge. Dates are calendar dates in the user's zone. */

import { daysBetween, resolveZone, todayKey } from "./zone";

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Reject dates the constructor rolled over, such as 2027-02-31.
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

/** Whole days from today (in `zone`, the browser's when omitted) to `examDate` (YYYY-MM-DD): 0 is today, null when it has passed or is invalid. */
export function daysUntilExam(examDate: string | null | undefined, now: Date, zone?: string): number | null {
  if (!examDate || !isValidDateOnly(examDate)) {
    return null;
  }
  const days = daysBetween(todayKey(resolveZone(zone), now), examDate);
  return days < 0 ? null : days;
}

/** "Exam today", "Exam in 1 day", "Exam in 18 days", or null when there is nothing to show. */
export function examLabel(examDate: string | null | undefined, now: Date, zone?: string): string | null {
  const days = daysUntilExam(examDate, now, zone);
  if (days === null) {
    return null;
  }
  if (days === 0) {
    return "Exam today";
  }
  return `Exam in ${days} ${days === 1 ? "day" : "days"}`;
}
