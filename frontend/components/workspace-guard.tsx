"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getStoredToken } from "@/lib/session";

export function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    const isAuthed = Boolean(token);
    setHasToken(isAuthed);
    setReady(true);

    if (!isAuthed) {
      router.replace("/auth");
    }
  }, [router]);

  if (!ready || !hasToken) {
    return null;
  }

  return <>{children}</>;
}
