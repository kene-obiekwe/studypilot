import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkPairs, contrastRatio, COURSE_PAIRS, KEY_PAIRS, parseThemeTokens, type ContrastResult } from "../lib/contrast";

const css = readFileSync(join(__dirname, "tokens.css"), "utf8");
const tokens = parseThemeTokens(css);

function report(title: string, results: ContrastResult[]): void {
  // CONTRAST_REPORT=1 npx vitest run styles/tokens.test.ts prints the full table.
  if (!process.env.CONTRAST_REPORT) return;
  const rows = results.map((r) => ({
    theme: r.theme,
    pair: `${r.foreground} on ${r.background}`,
    ratio: r.ratio.toFixed(2),
    min: r.min,
    result: r.pass ? "pass" : "FAIL",
    use: r.use,
  }));
  console.log(`\n${title}`);
  console.table(rows);
}

describe("contrast maths", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("design tokens", () => {
  it("define a full, separate set for both themes", () => {
    const lightNames = Object.keys(tokens.light).sort();
    const darkNames = Object.keys(tokens.dark).sort();
    expect(lightNames.length).toBeGreaterThan(50);
    expect(darkNames).toEqual(lightNames);
    // Dark is designed, not a copy of light.
    const shared = lightNames.filter((name) => tokens.light[name] === tokens.dark[name]);
    expect(shared).toEqual([]);
  });

  it("dark surfaces step up in lightness (canvas < surface < raised)", () => {
    const lum = (name: string) => contrastRatio(tokens.dark[name], "#000000");
    expect(lum("canvas")).toBeLessThan(lum("surface"));
    expect(lum("surface")).toBeLessThan(lum("raised"));
  });

  it("key text and UI pairs meet WCAG AA in both themes", () => {
    const results = checkPairs(tokens, KEY_PAIRS);
    report("Key pairs", results);
    const failures = results.filter((r) => !r.pass).map((r) => `${r.theme}: ${r.foreground} on ${r.background} = ${r.ratio.toFixed(2)} < ${r.min}`);
    expect(failures).toEqual([]);
  });

  it("every course colour meets AA for text on its tint and 3:1 for its dot and bar", () => {
    const results = checkPairs(tokens, COURSE_PAIRS);
    report("Course palette", results);
    const failures = results.filter((r) => !r.pass).map((r) => `${r.theme}: ${r.foreground} on ${r.background} = ${r.ratio.toFixed(2)} < ${r.min}`);
    expect(failures).toEqual([]);
  });
});
