"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { hasSession } from "@/lib/session";

/** Auth screens are for signed-out visitors: someone with a session goes straight to `target`. */
export function useSignedInRedirect(target: string): void {
  const router = useRouter();
  useEffect(() => {
    if (hasSession()) {
      router.replace(target);
    }
  }, [router, target]);
}
