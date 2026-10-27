// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The page action renders into the app shell's header slot, which isn't mounted here.
vi.mock("@/components/app-shell", () => ({ PageAction: () => null }));

vi.mock("@/lib/api", () => ({
  getCourseRecommendations: vi.fn(),
  sendStrategyFeedback: vi.fn(),
  getCoursePlan: vi.fn(),
}));

import {
  getCoursePlan,
  getCourseRecommendations,
  sendStrategyFeedback,
  type CourseEvidence,
  type CourseRecommendation,
  type CourseRecommendations,
  type CourseRecommendationsResponse,
} from "@/lib/api";
import { cleanup, click, flush, render } from "@/test/dom";

import { COLLAPSED_STORAGE_KEY, resetCollapsedCache } from "./collapsed-courses";
import StrategiesPage from "./page";

function rec(id: number, overrides: Partial<CourseRecommendation> = {}): CourseRecommendation {
  return {
    shown_id: id,
    strategy_id: `strategy_${id}`,
    kind: "technique",
    priority: 50,
    basis: "settings",
    title: `Strategy ${id}`,
    what: `What to do for ${id}.`,
    how: [`Step one for ${id}.`, `Step two for ${id}.`],
    why: `Why ${id} was chosen.`,
    triggers: [],
    facts: {},
    source: { citation: "Full citation", short: `Author ${id}, 2006`, note: id === 1 ? "A note on the evidence." : undefined },
    feedback: { rating: null, tried: false },
    ...overrides,
  };
}

function course(id: number, name: string, recommendations: CourseRecommendation[]): CourseRecommendations {
  return {
    course: {
      id,
      name,
      difficulty: 3,
      learning_demands: [],
      builds_on_earlier: null,
      assessment_format: null,
      exam_date: null,
    },
    evidence: { basis: "history", summary: "Based on 4 sessions over 4 weeks" } as CourseEvidence,
    recommendations,
  };
}

function response(aiPlanAvailable = false): CourseRecommendationsResponse {
  return {
    generated_at: "2026-10-27T10:00:00Z",
    week_start: "2026-10-26",
    ai_plan_available: aiPlanAvailable,
    courses: [
      course(11, "Algorithms", [rec(1, { basis: "history" }), rec(2)]),
      course(12, "Physics", [rec(3), rec(4, { basis: "history" })]),
      course(13, "Statistics", [rec(5)]),
    ],
  };
}

async function renderPage(aiPlanAvailable = false) {
  vi.mocked(getCourseRecommendations).mockResolvedValue(response(aiPlanAvailable));
  const rendered = await render(<StrategiesPage />);
  await flush();
  await flush();
  return rendered.container;
}

function row(container: HTMLElement, title: string): HTMLLIElement {
  const heading = [...container.querySelectorAll("h3")].find((item) => item.textContent === title);
  if (!heading) throw new Error(`No strategy "${title}"`);
  return heading.closest("li")!;
}

function courseToggle(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("h2 button")].find((item) => item.textContent === name);
  if (!button) throw new Error(`No course toggle "${name}"`);
  return button;
}

function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
}

beforeEach(() => {
  window.localStorage.clear();
  resetCollapsedCache();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(getCourseRecommendations).mockReset();
  vi.mocked(sendStrategyFeedback).mockReset();
  vi.mocked(getCoursePlan).mockReset();
});

describe("Strategies page", () => {
  it("fetches once when shown and lists every course's strategies", async () => {
    const container = await renderPage();
    expect(getCourseRecommendations).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("li h3")).toHaveLength(5);
  });

  it("keeps rows compact: title and controls visible, what / why / how / source in the disclosure", async () => {
    const container = await renderPage();
    const item = row(container, "Strategy 1");
    const details = item.querySelector("details")!;

    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Why and how");
    for (const text of ["What to do for 1.", "Why 1 was chosen.", "Step one for 1.", "Author 1, 2006", "A note on the evidence."]) {
      expect(details.textContent).toContain(text);
    }
    // Outside the disclosure: the title, the badge and the controls only.
    const outside = item.textContent!.replace(details.textContent!, "");
    expect(outside).not.toContain("Why 1 was chosen.");
    expect(item.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(item.querySelector('[role="group"]')?.textContent).toContain("Helpful");
  });

  it("shows the basis badge only for data-backed strategies", async () => {
    const container = await renderPage();
    expect(row(container, "Strategy 1").textContent).toContain("From your data");
    expect(row(container, "Strategy 2").textContent).not.toContain("From your data");
    expect(container.textContent).not.toContain("From course settings");
  });

  it("starts expanded and remembers a collapsed course", async () => {
    let container = await renderPage();
    const toggle = courseToggle(container, "Physics");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.hidden).toBe(true);
    expect(window.localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBe("[12]");
    // The heading still says how many strategies are inside.
    expect(toggle.closest("section")?.textContent).toContain("2 strategies");

    cleanup();
    resetCollapsedCache();
    container = await renderPage();
    expect(courseToggle(container, "Physics").getAttribute("aria-expanded")).toBe("false");
    expect(courseToggle(container, "Algorithms").getAttribute("aria-expanded")).toBe("true");

    await click(courseToggle(container, "Physics"));
    expect(window.localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBeNull();
  });

  it("still collapses for this page view when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const container = await renderPage();
    const toggle = courseToggle(container, "Algorithms");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("hides the weekly plan button when AI plans are off", async () => {
    const container = await renderPage(false);
    expect(buttonNamed(container, "Write my weekly plan")).toBeUndefined();
  });

  it("writing the weekly plan opens a collapsed course", async () => {
    vi.mocked(getCoursePlan).mockResolvedValue({
      source: "ai",
      week_start: "2026-10-26",
      intro: "This week, focus on retrieval.",
      items: [],
      throttled: false,
    });
    const container = await renderPage(true);
    const toggle = courseToggle(container, "Statistics");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const write = [...toggle.closest("section")!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Write my weekly plan",
    )!;
    await click(write);
    await flush();

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(getCoursePlan).toHaveBeenCalledWith(13);
    expect(toggle.closest("section")?.textContent).toContain("This week, focus on retrieval.");
  });

  it("rolls back an optimistic rating when saving fails", async () => {
    vi.mocked(sendStrategyFeedback).mockRejectedValue(new Error("Network down"));
    const container = await renderPage();
    const helpful = [...row(container, "Strategy 2").querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Helpful",
    )!;

    await click(helpful);
    await flush();

    expect(sendStrategyFeedback).toHaveBeenCalledWith(2, "helpful");
    expect(helpful.getAttribute("aria-pressed")).toBe("false");
    expect(row(container, "Strategy 2").textContent).toContain("Couldn't save that: Network down");
  });
});
