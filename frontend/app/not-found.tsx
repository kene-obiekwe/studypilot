import type { Metadata } from "next";

import { ErrorView } from "@/components/monitoring/ErrorView";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <ErrorView
      icon="compass"
      title="Page not found"
      description="That address doesn't lead anywhere. It may have moved, or the link may have a typo."
    />
  );
}
