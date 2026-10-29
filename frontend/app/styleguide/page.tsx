import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { checkPairs, COURSE_PAIRS, KEY_PAIRS, parseThemeTokens } from "@/lib/contrast";

import { StyleguideClient } from "./StyleguideClient";

export const metadata: Metadata = {
  title: "Styleguide",
  robots: { index: false, follow: false },
};

/**
 * Development-only reference of every token and component state. In production builds it is a
 * 404 unless the server-only STYLEGUIDE_ENABLED=true is set (e.g. for a design-review preview).
 */
export default function StyleguidePage() {
  if (process.env.NODE_ENV !== "development" && process.env.STYLEGUIDE_ENABLED !== "true") {
    notFound();
  }
  const css = readFileSync(join(process.cwd(), "styles", "tokens.css"), "utf8");
  const tokens = parseThemeTokens(css);
  const contrast = checkPairs(tokens, [...KEY_PAIRS, ...COURSE_PAIRS]);
  return <StyleguideClient tokens={tokens} contrast={contrast} />;
}
