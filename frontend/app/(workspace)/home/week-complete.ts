import type { SessionHistoryItem } from "@/lib/api";
import { courseHoursThisWeek, currentPlanThisWeek, planEntries, type PlanLike } from "@/lib/week";

/** The week's plan total when every course in it has reached its planned hours, else null (no plan, or hours still to do). */
export function completedWeekHours(plans: readonly PlanLike[], sessions: readonly SessionHistoryItem[], now: Date): number | null {
  const entries = planEntries(currentPlanThisWeek(plans, now));
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, entry) => sum + entry.plannedHours, 0);
  if (total <= 0) return null;
  const allDone = entries.every((entry) => courseHoursThisWeek(entry.name, plans, sessions, now).status === "done");
  return allDone ? total : null;
}
