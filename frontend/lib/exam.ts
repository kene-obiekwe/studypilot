/** Days until an exam, for the "Exam in N days" badge. Dates are local calendar dates. */

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // Reject dates the constructor rolled over, such as 2027-02-31.
  const valid = date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day);
  return valid ? date : null;
}

/** Whole days from today to `examDate` (YYYY-MM-DD): 0 is today, null when it has passed or is invalid. */
export function daysUntilExam(examDate: string | null | undefined, now: Date): number | null {
  if (!examDate) {
    return null;
  }
  const exam = parseDateOnly(examDate);
  if (!exam) {
    return null;
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((exam.getTime() - today.getTime()) / DAY_MS); // rounding absorbs clock changes
  return days < 0 ? null : days;
}

/** "Exam today", "Exam in 1 day", "Exam in 18 days", or null when there is nothing to show. */
export function examLabel(examDate: string | null | undefined, now: Date): string | null {
  const days = daysUntilExam(examDate, now);
  if (days === null) {
    return null;
  }
  if (days === 0) {
    return "Exam today";
  }
  return `Exam in ${days} ${days === 1 ? "day" : "days"}`;
}
