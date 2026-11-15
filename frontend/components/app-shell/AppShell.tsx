"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Lockup, LogoMark } from "@/components/brand";
import { TimerPill, TimerProvider } from "@/components/timer";
import { NavItem, ThemeToggle, UiRoot } from "@/components/ui";
import { isActive, NAV_ITEMS, pageTitle } from "@/lib/nav";
import { readSidebar, SIDEBAR_COLLAPSED_WIDTH, writeSidebar, type SidebarLayout } from "@/lib/sidebar";

import { PageActionProvider, PageActionSlot } from "./PageAction";
import { ShellDataProvider } from "./ShellData";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { UserMenu } from "./UserMenu";
import { WeekMeter, WeekMeterSkeleton } from "./WeekMeter";
import styles from "./shell.module.css";

/**
 * Workspace layout. Desktop (>= 768px): sidebar with the five destinations, the week meter,
 * theme toggle and account menu; a top bar with the page title and an action slot. The sidebar
 * can be dragged wider or narrower by its right edge, or collapsed to an icon rail; the choice is
 * remembered in this browser.
 * Phones: a compact top bar (title + account menu with the theme choice) and a bottom tab bar.
 * DOM order gives the focus order: skip link, sidebar, top bar, main, then the tab bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const title = pageTitle(pathname);

  // Moving to another section lands focus on the new page's content instead of leaving it on the
  // nav link; the sub-tabs inside /progress keep their own focus.
  const mainRef = useRef<HTMLElement>(null);
  const section = pathname?.split("/")[1] ?? "";
  const shownSection = useRef(section);
  useEffect(() => {
    if (shownSection.current === section) return;
    shownSection.current = section;
    mainRef.current?.focus({ preventScroll: true });
  }, [section]);

  // The shell renders only in the browser (WorkspaceGuard), so storage can be read on first render.
  const [sidebar, setSidebar] = useState<SidebarLayout>(readSidebar);
  const [resizing, setResizing] = useState(false);
  const saveSidebar = (next: SidebarLayout) => {
    setSidebar(next);
    writeSidebar(next);
  };
  const collapsed = sidebar.collapsed;
  const shellStyle = {
    "--sp-sidebar-width": `${collapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebar.width}px`,
  } as CSSProperties;

  return (
    <ShellDataProvider>
      <PageActionProvider>
        <UiRoot className={styles.shell} style={shellStyle} data-resizing={resizing || undefined}>
          <TimerProvider>
            <a href="#main-content" className={styles.skip}>
              Skip to content
            </a>

            <div className={styles.sidebarFrame}>
              <aside id="app-sidebar" className={styles.sidebar} data-collapsed={collapsed || undefined}>
                <div className={styles.sidebarHead}>
                  {collapsed ? (
                    <Link href="/home" className={styles.brand} aria-label="StudyPilot home" title="StudyPilot">
                      <LogoMark size={27} />
                    </Link>
                  ) : (
                    <Link href="/home" className={styles.brand}>
                      <Lockup fontSize={17} />
                    </Link>
                  )}
                  <button
                    type="button"
                    className={styles.collapseButton}
                    aria-controls="app-sidebar"
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    onClick={() => saveSidebar({ ...sidebar, collapsed: !collapsed })}
                  >
                    {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
                  </button>
                </div>
                <nav aria-label="Main">
                  <ul className={styles.navList}>
                    {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                      <li key={href}>
                        <NavItem
                          href={href}
                          label={label}
                          icon={<Icon size={18} />}
                          active={isActive(pathname, href)}
                          title={collapsed ? label : undefined}
                        />
                      </li>
                    ))}
                  </ul>
                </nav>
                <div className={styles.sidebarFooter}>
                  {!collapsed && (
                    <>
                      <Suspense fallback={<WeekMeterSkeleton />}>
                        <WeekMeter />
                      </Suspense>
                      <ThemeToggle className={styles.sidebarTheme} />
                    </>
                  )}
                  <UserMenu placement="sidebar" compact={collapsed} />
                </div>
              </aside>
              {!collapsed && (
                <SidebarResizeHandle
                  width={sidebar.width}
                  controls="app-sidebar"
                  onResize={(width) => setSidebar((current) => ({ ...current, width }))}
                  onCommit={(width) => saveSidebar({ width, collapsed: false })}
                  onDraggingChange={setResizing}
                />
              )}
            </div>

            <div className={styles.column}>
              <header className={styles.topBar}>
                <h1 className={styles.title}>{title}</h1>
                <div className={styles.topBarEnd}>
                  <Suspense fallback={null}>
                    <TimerPill />
                  </Suspense>
                  <PageActionSlot />
                  <div className={styles.mobileOnly}>
                    <UserMenu placement="topbar" />
                  </div>
                </div>
              </header>
              <main ref={mainRef} id="main-content" tabIndex={-1} className={styles.main}>
                <div className={styles.mainInner}>{children}</div>
              </main>
            </div>

            <nav aria-label="Main" className={styles.tabBar}>
              <ul className={styles.tabList}>
                {NAV_ITEMS.map(({ href, shortLabel, icon: Icon }) => (
                  <li key={href}>
                    <NavItem
                      layout="tab"
                      href={href}
                      label={shortLabel}
                      icon={<Icon size={20} />}
                      active={isActive(pathname, href)}
                    />
                  </li>
                ))}
              </ul>
            </nav>
          </TimerProvider>
        </UiRoot>
      </PageActionProvider>
    </ShellDataProvider>
  );
}
