"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { clearStoredToken } from "@/lib/session";

const labelMap: Record<string, string> = {
  overview: "Overview",
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
  const router = useRouter();
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

  const onSignOut = () => {
    clearStoredToken();
    router.replace("/");
  };

  return (
    <header className="top-chrome">
      <div className="route-progress-track" aria-hidden="true">
        <span key={progressKey} className="route-progress-bar" />
      </div>

      <div className="crumbs-row">
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

        <button type="button" className="secondary ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
