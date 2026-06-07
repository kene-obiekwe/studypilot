import { MainNav } from "@/components/main-nav";
import { TopChrome } from "@/components/top-chrome";
import { WorkspaceGuard } from "@/components/workspace-guard";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceGuard>
      <div className="app-shell">
        <MainNav />
        <section className="panel main-panel animate-in">
          <TopChrome />
          {children}
        </section>
      </div>
    </WorkspaceGuard>
  );
}
