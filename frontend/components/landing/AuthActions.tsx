"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight } from "lucide-react";

import { cx } from "@/components/ui/cx";
import { hasSession } from "@/lib/session";

import styles from "./landing.module.css";

// Re-check when another tab signs in or out (localStorage "storage" events).
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** null on the server and during hydration: unknown until the browser can read storage. */
const unknownOnServer = (): boolean | null => null;

/**
 * The landing page's calls to action. Signed out: "Get started" and "Sign in". Signed in: one
 * "Go to your week" link. While the session is still unknown (the static HTML, before
 * hydration) the signed-out links hold their space but stay invisible and inert, so neither set
 * flashes up and then swaps.
 */
export function AuthActions({ placement }: { placement: "header" | "hero" }) {
  const signedIn = useSyncExternalStore<boolean | null>(subscribe, hasSession, unknownOnServer);
  const size = placement === "header" ? styles.ctaSm : styles.ctaMd;
  const row = cx(styles.actions, placement === "hero" && styles.actionsHero);

  if (signedIn) {
    return (
      <div className={row}>
        <Link href="/home" className={cx(styles.cta, styles.ctaPrimary, size)}>
          Go to your week
          {placement === "hero" && <ArrowRight size={16} aria-hidden="true" />}
        </Link>
      </div>
    );
  }

  const pending = signedIn === null;
  return (
    <div className={row} data-pending={pending || undefined} inert={pending}>
      {placement === "header" ? (
        <>
          <Link href="/sign-in" className={cx(styles.cta, styles.ctaGhost, size, styles.wideOnly)}>
            Sign in
          </Link>
          <Link href="/sign-up" className={cx(styles.cta, styles.ctaPrimary, size)}>
            Get started
          </Link>
        </>
      ) : (
        <>
          <Link href="/sign-up" className={cx(styles.cta, styles.ctaPrimary, size)}>
            Get started
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link href="/sign-in" className={cx(styles.cta, styles.ctaSecondary, size)}>
            Sign in
          </Link>
        </>
      )}
    </div>
  );
}
