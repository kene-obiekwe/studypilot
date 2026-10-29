"use client";

import { useSearchParams } from "next/navigation";

import { Notice } from "@/components/ui";

/** "Your account was deleted." after the account page sends the user here with ?account=deleted. */
export function AccountDeletedNotice({ className }: { className?: string }) {
  const params = useSearchParams();
  if (params.get("account") !== "deleted") return null;
  return (
    <div className={className}>
      <Notice tone="success">Your account was deleted.</Notice>
    </div>
  );
}
