"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const labelMap: Record<string, string> = {
  overview: "Overview",
  auth: "Authentication",
  planner: "Study Planner",
  recommendations: "Recommendations",
  progress: "Progress",
};

function toLabel(segment: string): string {
  if (labelMap[segment]) {
    return labelMap[segment];
  }
  return segment
    .split("-")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function TopChrome() {
  const pathname = usePathname();
  const [progressKey, setProgressKey] = useState(0);

  useEffect(() => {
    setProgressKey((prev) => prev + 1);
  }, [pathname]);

  const crumbs = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    const built = [] as Array<{ href: string; label: string }>;

    if (parts.length === 0) {
      return [{ href: "/overview", label: "Overview" }];
    }

    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      built.push({ href: current, label: toLabel(part) });
    }

    return built;
  }, [pathname]);

  return (
    <header className="top-chrome">
      <div className="route-progress-track" aria-hidden="true">
        <span key={progressKey} className="route-progress-bar" />
      </div>

      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <div key={crumb.href} className="crumb-item">
              {index > 0 && <ChevronRight size={14} className="crumb-sep" />}
              {isLast ? (
                <span className="crumb-current">{crumb.label}</span>
              ) : (
                <Link href={crumb.href} className="crumb-link">
                  {crumb.label}
                </Link>
              )}
            </div>
          );
        })}
      </nav>
    </header>
  );
}
