"use client";

import { useEffect, useState } from "react";

import { Notice } from "@/components/ui";
import { checkBackend, wasBackendRecentlyAwake } from "@/lib/api";

import styles from "./auth.module.css";

type WakeState = "hidden" | "waiting" | "ready" | "slow";

/** How long a warm server gets to answer before the notice appears (avoids a flash). */
const SHOW_AFTER_MS = 1500;

/**
 * Tells people on the auth pages to wait while the free-tier server starts. The forms stay
 * usable in every state; this only informs.
 */
export function ServerWakeNotice() {
  const [state, setState] = useState<WakeState>("hidden");

  useEffect(() => {
    if (wasBackendRecentlyAwake()) return;
    let active = true;
    let shown = false;
    const timer = setTimeout(() => {
      if (!active) return;
      shown = true;
      setState("waiting");
    }, SHOW_AFTER_MS);
    void checkBackend().then((result) => {
      clearTimeout(timer);
      if (!active) return;
      if (result === "awake") {
        if (shown) setState("ready");
      } else {
        setState("slow");
      }
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  if (state === "hidden") return null;

  return (
    <div className={styles.wakeNotice}>
      {state === "waiting" && (
        <Notice
          tone="info"
          title={
            <>
              <span className={styles.wakePulse} aria-hidden="true" />
              Starting up the server
            </>
          }
        >
          StudyPilot runs on a free server that goes to sleep when nobody is using it. Waking it up can take up to a
          minute. Please wait until this message says the server is ready before you sign in or create an account.
        </Notice>
      )}
      {state === "ready" && (
        <Notice tone="success" title="The server is ready">
          You can sign in or create an account now.
        </Notice>
      )}
      {state === "slow" && (
        <Notice tone="warning" title="This is taking longer than usual">
          The server hasn&apos;t answered yet. Wait a moment, then refresh the page. If it still doesn&apos;t load, try
          again in a few minutes.
        </Notice>
      )}
    </div>
  );
}
