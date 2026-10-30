"use client";

import { useEffect } from "react";

import { ErrorView, errorReference } from "@/components/monitoring/ErrorView";
import { reportError } from "@/lib/monitoring";

/** Renders inside the app shell, so the navigation stays available. */
export default function WorkspaceError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <ErrorView
      layout="inline"
      title="Something went wrong"
      description="This page hit an unexpected problem. Trying again often fixes it, and the rest of the app still works."
      reference={errorReference(error)}
      onTryAgain={retry}
    />
  );
}
