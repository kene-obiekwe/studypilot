"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, CalendarClock, Compass, Sparkles } from "lucide-react";

const navItems = [
  { href: "/overview", label: "Overview", icon: Compass },
  { href: "/planner", label: "Study Planner", icon: CalendarClock },
  { href: "/recommendations", label: "Recommendations", icon: Bot },
  { href: "/progress", label: "Progress", icon: BarChart3 },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <aside className="panel nav-panel animate-in">
      <div className="nav-head">
        <span className="brand-kicker">
          <Sparkles size={14} /> StudyPilot AI
        </span>
        <h1 className="brand-title">Smart Study Workspace</h1>
        <p className="brand-sub">Plan, adapt, and improve your learning rhythm.</p>
      </div>

      <nav className="nav-links" aria-label="Primary">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link key={item.href} className={`nav-link ${active ? "active" : ""}`} href={item.href}>
              <Icon size={17} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
