import { ProgressProvider, ProgressTabNav } from "./_lib/shared";

export default function ProgressLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProgressProvider>
      <ProgressTabNav />
      {children}
    </ProgressProvider>
  );
}
