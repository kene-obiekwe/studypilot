import { BookOpen, CalendarRange, ChartLine, House, Lightbulb, type LucideIcon } from "lucide-react";

export type NavDestination = {
  href: string;
  /** Sidebar label and default page title. */
  label: string;
  /** Bottom tab bar label (phones). */
  shortLabel: string;
  icon: LucideIcon;
};

/** The five workspace destinations, in navigation order. */
export const NAV_ITEMS: NavDestination[] = [
  { href: "/home", label: "This week", shortLabel: "Week", icon: House },
  { href: "/courses", label: "Courses", shortLabel: "Courses", icon: BookOpen },
  { href: "/planner", label: "Planner", shortLabel: "Planner", icon: CalendarRange },
  { href: "/strategies", label: "Strategies", shortLabel: "Strategies", icon: Lightbulb },
  { href: "/progress", label: "Progress", shortLabel: "Progress", icon: ChartLine },
];

/** A destination is active on its own path and on any sub-route (/progress/log), not on look-alikes (/progressive). */
export function isActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return path === href || path.startsWith(`${href}/`);
}

export function activeDestination(pathname: string | null | undefined): NavDestination | undefined {
  return NAV_ITEMS.find((item) => isActive(pathname, item.href));
}

const SUB_ROUTE_TITLES: Record<string, string> = {
  "/progress/log": "Log a session",
  "/progress/history": "History",
  "/progress/predict": "Forecast",
};

/** The h1 for the top bar. */
export function pageTitle(pathname: string | null | undefined): string {
  const path = pathname?.replace(/\/+$/, "") ?? "";
  return SUB_ROUTE_TITLES[path] ?? activeDestination(pathname)?.label ?? "StudyPilot";
}
