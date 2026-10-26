"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass } from "lucide-react";

import { TimerPill, TimerProvider } from "@/components/timer";
import { NavItem, ThemeToggle, UiRoot } from "@/components/ui";
import { isActive, NAV_ITEMS, pageTitle } from "@/lib/nav";

import { PageActionProvider, PageActionSlot } from "./PageAction";
import { ShellDataProvider } from "./ShellData";
import { UserMenu } from "./UserMenu";
import { WeekMeter, WeekMeterSkeleton } from "./WeekMeter";
import styles from "./shell.module.css";

/**
 * Workspace layout. Desktop (>= 768px): sidebar with the five destinations, the week meter,
 * theme toggle and account menu; a top bar with the page title and an action slot.
 * Phones: a compact top bar (title + account menu with the theme choice) and a bottom tab bar.
 * DOM order gives the focus order: skip link, sidebar, top bar, main, then the tab bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const title = pageTitle(pathname);

  return (
    <ShellDataProvider>
      <PageActionProvider>
        <UiRoot className={styles.shell}>
          <TimerProvider>
            <a href="#main-content" className={styles.skip}>
              Skip to content
            </a>

            <aside className={styles.sidebar}>
              <Link href="/home" className={styles.brand}>
                <span className={styles.brandMark} aria-hidden="true">
                  <Compass size={16} />
                </span>
                StudyPilot
              </Link>
              <nav aria-label="Main">
                <ul className={styles.navList}>
                  {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                    <li key={href}>
                      <NavItem href={href} label={label} icon={<Icon size={18} />} active={isActive(pathname, href)} />
                    </li>
                  ))}
                </ul>
              </nav>
              <div className={styles.sidebarFooter}>
                <Suspense fallback={<WeekMeterSkeleton />}>
                  <WeekMeter />
                </Suspense>
                <ThemeToggle className={styles.sidebarTheme} />
                <UserMenu placement="sidebar" />
              </div>
            </aside>

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
              <main id="main-content" tabIndex={-1} className={styles.main}>
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
