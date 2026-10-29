"use client";

import { Suspense, useId, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";

import { Button, SegmentedControl } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import uiStyles from "@/components/ui/ui.module.css";
import { clearSession } from "@/lib/session";
import { getServerPreference, readPreference, setPreference, subscribe, type ThemePreference } from "@/lib/theme";

import { useShellData } from "./ShellData";
import styles from "./shell.module.css";

type Placement = "sidebar" | "topbar";

/**
 * Account button + menu on the native Popover API: it opens in the top layer and closes on Esc
 * or a click outside without any React state. The menu holds the theme choice on phones.
 */
export function UserMenu({ placement }: { placement: Placement }) {
  const menuId = useId();
  return (
    <>
      <Suspense fallback={<UserButton placement={placement} menuId={menuId} name={null} />}>
        <LoadedUserButton placement={placement} menuId={menuId} />
      </Suspense>
      <div
        id={menuId}
        popover="auto"
        className={`${styles.menu} ${placement === "sidebar" ? styles.menuSidebar : styles.menuTopBar}`}
      >
        <Suspense fallback={null}>
          <MenuHeader />
        </Suspense>
        {placement === "topbar" && <CompactThemeChoice />}
        <AccountLink menuId={menuId} />
        <SignOutButton />
      </div>
    </>
  );
}

function LoadedUserButton({ placement, menuId }: { placement: Placement; menuId: string }) {
  const { me } = useShellData();
  return <UserButton placement={placement} menuId={menuId} name={me?.username ?? null} />;
}

function UserButton({ placement, menuId, name }: { placement: Placement; menuId: string; name: string | null }) {
  const label = name ?? "Account";
  return (
    <button
      type="button"
      popoverTarget={menuId}
      aria-label={placement === "topbar" ? `Account menu for ${label}` : undefined}
      className={`${styles.userButton} ${placement === "topbar" ? styles.userButtonCompact : ""}`}
    >
      <span className={styles.avatar} aria-hidden="true">
        {label.charAt(0)}
      </span>
      {placement === "sidebar" && <span className={styles.userName}>{label}</span>}
    </button>
  );
}

function MenuHeader() {
  const { me } = useShellData();
  if (!me) return null;
  return (
    <div className={styles.menuHeader}>
      <p className={styles.menuName}>{me.username}</p>
      {me.email && <p className={styles.menuEmail}>{me.email}</p>}
    </div>
  );
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: React.ReactNode; icon: React.ReactNode }> = [
  { value: "light", icon: <Sun size={14} />, label: <span className={styles.srOnly}>Light</span> },
  { value: "dark", icon: <Moon size={14} />, label: <span className={styles.srOnly}>Dark</span> },
  { value: "system", icon: <Monitor size={14} />, label: <span className={styles.srOnly}>System</span> },
];

/** Icon-only light/dark/system choice for the compact phone menu (labels stay for screen readers). */
function CompactThemeChoice() {
  const preference = useSyncExternalStore(subscribe, readPreference, getServerPreference);
  return (
    <div className={styles.menuTheme}>
      <span className={styles.menuThemeLabel} aria-hidden="true">
        Theme
      </span>
      <SegmentedControl label="Theme" options={THEME_OPTIONS} value={preference} onChange={setPreference} />
    </div>
  );
}

/** Styled like the ghost Sign out button below it. Following it closes the menu. */
function AccountLink({ menuId }: { menuId: string }) {
  return (
    <Link
      href="/account"
      className={cx(uiStyles.control, uiStyles.button, uiStyles.ghost, uiStyles.md, styles.menuSignOut)}
      onClick={() => document.getElementById(menuId)?.hidePopover?.()}
    >
      <span className={uiStyles.buttonIcon} aria-hidden="true">
        <UserRound size={16} />
      </span>
      Account
    </Link>
  );
}

function SignOutButton() {
  const router = useRouter();
  const onSignOut = () => {
    clearSession();
    router.replace("/");
  };
  return (
    <Button variant="ghost" icon={<LogOut size={16} />} className={styles.menuSignOut} onClick={onSignOut}>
      Sign out
    </Button>
  );
}
