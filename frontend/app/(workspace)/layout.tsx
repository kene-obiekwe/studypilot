import { AppShell, WorkspaceGuard } from "@/components/app-shell";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceGuard>
      <AppShell>{children}</AppShell>
    </WorkspaceGuard>
  );
}
