import { ProgressProvider } from "./_lib/shared";
import { ProgressTabs } from "./_lib/ProgressTabs";

export default function ProgressLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProgressProvider>
      <ProgressTabs />
      {children}
    </ProgressProvider>
  );
}
