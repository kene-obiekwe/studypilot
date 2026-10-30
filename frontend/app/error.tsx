"use client";

import { useEffect } from "react";

import { ErrorView, errorReference } from "@/components/monitoring/ErrorView";
import { reportError } from "@/lib/monitoring";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <ErrorView
      title="Something went wrong"
      description="This page hit an unexpected problem. Trying again often fixes it."
      reference={errorReference(error)}
      onTryAgain={retry}
    />
  );
}
