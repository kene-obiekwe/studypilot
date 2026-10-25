"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { hasSession } from "@/lib/session";

// Re-check when another tab signs in or out (localStorage "storage" events).
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** null on the server and during hydration: unknown until the browser can read storage. */
const unknownOnServer = (): boolean | null => null;

/**
 * Renders the workspace only with a session. Without one it renders nothing (no flash of
 * protected content) and sends the visitor to /sign-in, returning them here afterwards.
 */
export function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const signedIn = useSyncExternalStore<boolean | null>(subscribe, hasSession, unknownOnServer);

  useEffect(() => {
    if (signedIn === false) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
    }
  }, [signedIn, router]);

  return signedIn ? <>{children}</> : null;
}
