"use client";

import { Suspense } from "react";

import { useShellData } from "@/components/app-shell";
import { useRefreshShellData } from "@/components/app-shell/ShellData";
import { Button, Notice, Skeleton } from "@/components/ui";

import styles from "./account.module.css";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { PasswordSection } from "./PasswordSection";
import { ProfileSection } from "./ProfileSection";

export default function AccountPage() {
  return (
    <div className={styles.page}>
      <Suspense
        fallback={
          <div className={styles.page} aria-busy="true" aria-label="Loading your account">
            <Skeleton height={260} radius="lg" />
            <Skeleton height={320} radius="lg" />
            <Skeleton height={140} radius="lg" />
          </div>
        }
      >
        <AccountSections />
      </Suspense>
    </div>
  );
}

/** The signed-in user comes from the shell's data (one request, shared with the account menu). */
function AccountSections() {
  const { me } = useShellData();
  const refresh = useRefreshShellData();

  if (!me) {
    return (
      <Notice tone="danger" title="Could not load your account">
        Check your connection.{" "}
        <Button size="sm" variant="ghost" onClick={refresh}>
          Try again
        </Button>
      </Notice>
    );
  }

  return (
    <>
      <ProfileSection key={me.id} me={me} onChanged={refresh} />
      <PasswordSection />
      <DeleteAccountSection me={me} />
    </>
  );
}
