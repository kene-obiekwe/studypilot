import type { Metadata } from "next";

import { ProgressProvider } from "./_lib/shared";
import { ProgressTabs } from "./_lib/ProgressTabs";

// A layout that sets its own title restarts the template for the routes below it, so it repeats it.
export const metadata: Metadata = { title: { default: "Progress", template: "%s · StudyPilot" } };

export default function ProgressLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProgressProvider>
      <ProgressTabs />
      {children}
    </ProgressProvider>
  );
}
