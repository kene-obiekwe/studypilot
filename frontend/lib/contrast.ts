/** WCAG 2.x contrast maths and a parser for the --sp- colour tokens in styles/tokens.css. */

export const AA_TEXT = 4.5;
/** Large text (24px regular / 18.66px bold) and UI glyphs, borders and focus indicators. */
export const AA_LARGE_OR_UI = 3;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    throw new Error(`Expected a #rrggbb colour, got "${hex}"`);
  }
  const n = match[1];
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(n.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

export type ThemeName = "light" | "dark";
export type ThemeTokens = Record<string, string>;

/**
 * Pull the hex colour tokens out of the two theme blocks. The light block is the one whose
 * selector starts with ":root,"; the dark block is [data-theme="dark"]. Non-hex values
 * (rgba overlays, shadows) are skipped.
 */
export function parseThemeTokens(css: string): Record<ThemeName, ThemeTokens> {
  const blocks: Record<ThemeName, ThemeTokens> = { light: {}, dark: {} };
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const [, selector, body] of css.matchAll(blockPattern)) {
    const cleaned = selector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const theme: ThemeName | null = cleaned.startsWith(":root,")
      ? "light"
      : cleaned === '[data-theme="dark"]'
        ? "dark"
        : null;
    if (!theme) continue;
    for (const [, name, value] of body.matchAll(/--sp-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\b/gi)) {
      blocks[theme][name] = value.toLowerCase();
    }
  }
  return blocks;
}

export type ContrastPair = {
  foreground: string;
  background: string;
  min: number;
  use: string;
};

/** The pairs the UI actually renders. Token names are without the --sp- prefix. */
export const KEY_PAIRS: ContrastPair[] = [
  ...["canvas", "surface", "raised", "sunken"].flatMap((background) => [
    { foreground: "ink", background, min: AA_TEXT, use: "Body text" },
    { foreground: "ink-soft", background, min: AA_TEXT, use: "Secondary text" },
    { foreground: "muted", background, min: AA_TEXT, use: "Hints, placeholders" },
  ]),
  { foreground: "accent", background: "canvas", min: AA_TEXT, use: "Links on the page" },
  { foreground: "accent", background: "surface", min: AA_TEXT, use: "Links in cards" },
  { foreground: "on-accent", background: "accent", min: AA_TEXT, use: "Primary button text" },
  { foreground: "on-accent", background: "accent-hover", min: AA_TEXT, use: "Primary button, hover" },
  { foreground: "ink", background: "accent-soft", min: AA_TEXT, use: "Text on the accent tint (today, selected)" },
  { foreground: "ink-soft", background: "accent-soft", min: AA_TEXT, use: "Secondary text on the accent tint" },
  { foreground: "muted", background: "accent-soft", min: AA_TEXT, use: "Hints on the accent tint (week strip, today)" },
  { foreground: "accent-ink", background: "accent-soft", min: AA_TEXT, use: "Accent badge, selected item" },
  { foreground: "accent", background: "accent-soft", min: AA_LARGE_OR_UI, use: "Progress fill on its track" },
  { foreground: "focus", background: "canvas", min: AA_LARGE_OR_UI, use: "Focus ring" },
  { foreground: "focus", background: "surface", min: AA_LARGE_OR_UI, use: "Focus ring on cards" },
  { foreground: "line-strong", background: "canvas", min: AA_LARGE_OR_UI, use: "Input borders" },
  { foreground: "line-strong", background: "surface", min: AA_LARGE_OR_UI, use: "Input borders in cards" },
  { foreground: "on-exam", background: "exam", min: AA_TEXT, use: "Text on an amber fill" },
  { foreground: "exam-ink", background: "exam-soft", min: AA_TEXT, use: "Exam pill" },
  { foreground: "exam-strong", background: "surface", min: AA_LARGE_OR_UI, use: "Exam icon or border" },
  { foreground: "success-ink", background: "success-soft", min: AA_TEXT, use: "Success badge, notice" },
  { foreground: "success", background: "surface", min: AA_LARGE_OR_UI, use: "Success icon" },
  { foreground: "danger", background: "surface", min: AA_TEXT, use: "Error text" },
  { foreground: "danger-ink", background: "danger-soft", min: AA_TEXT, use: "Danger badge, notice" },
  { foreground: "on-danger", background: "danger", min: AA_TEXT, use: "Danger button text" },
  { foreground: "on-danger", background: "danger-hover", min: AA_TEXT, use: "Danger button, hover" },
];

export const COURSE_HUE_COUNT = 8;

export const COURSE_PAIRS: ContrastPair[] = Array.from({ length: COURSE_HUE_COUNT }, (_, i) => [
  { foreground: `course-${i}-ink`, background: `course-${i}-tint`, min: AA_TEXT, use: `Course ${i}: text on tint` },
  { foreground: `course-${i}-dot`, background: "surface", min: AA_LARGE_OR_UI, use: `Course ${i}: dot/bar on surface` },
  { foreground: `course-${i}-dot`, background: "canvas", min: AA_LARGE_OR_UI, use: `Course ${i}: dot/bar on canvas` },
  { foreground: `course-${i}-dot`, background: `course-${i}-tint`, min: AA_LARGE_OR_UI, use: `Course ${i}: bar on its tint track` },
]).flat();

export type ContrastResult = ContrastPair & { theme: ThemeName; ratio: number; pass: boolean };

export function checkPairs(tokens: Record<ThemeName, ThemeTokens>, pairs: ContrastPair[]): ContrastResult[] {
  const results: ContrastResult[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const pair of pairs) {
      const fg = tokens[theme][pair.foreground];
      const bg = tokens[theme][pair.background];
      if (!fg || !bg) {
        throw new Error(`Missing token in ${theme}: ${!fg ? pair.foreground : pair.background}`);
      }
      const ratio = contrastRatio(fg, bg);
      results.push({ ...pair, theme, ratio, pass: ratio >= pair.min });
    }
  }
  return results;
}
