"use client";

import "./globals.css";
import "../styles/tokens.css";

import { useEffect } from "react";

import { ErrorView, errorReference } from "@/components/monitoring/ErrorView";
import { reportError } from "@/lib/monitoring";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/** Replaces the root layout when it crashes, so it brings its own document, styles and theme. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Something went wrong · StudyPilot</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ErrorView
          title="Something went wrong"
          description="StudyPilot hit an unexpected problem. Trying again often fixes it."
          reference={errorReference(error)}
          onTryAgain={retry}
        />
      </body>
    </html>
  );
}
