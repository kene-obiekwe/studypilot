import { MainNav } from "@/components/main-nav";
import { TopChrome } from "@/components/top-chrome";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <MainNav />
      <section className="panel main-panel animate-in">
        <TopChrome />
        {children}
      </section>
    </div>
  );
}
