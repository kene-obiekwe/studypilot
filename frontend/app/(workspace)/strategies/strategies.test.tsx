// @vitest-environment jsdom
import axe from "axe-core";
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
  writeCoursePlan: vi.fn(),
}));

import {
  getCoursePlan,
  getCourseRecommendations,
  sendStrategyFeedback,
  writeCoursePlan,
  type CourseEvidence,
  type CoursePlan,
  type CoursePlanResponse,
  type CourseRecommendation,
  type CourseRecommendations,
  type CourseRecommendationsResponse,
  type SavedPlanStatus,
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

function course(
  id: number,
  name: string,
  recommendations: CourseRecommendation[],
  savedPlan: SavedPlanStatus | null = null,
): CourseRecommendations {
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
    saved_plan: savedPlan,
  };
}

const current: SavedPlanStatus = { written_at: "2026-10-27T09:30:00+00:00", outdated: false, new_sessions: 0, course_changed: false };

/** Saved-plan status by course id: 11 Algorithms, 12 Physics, 13 Statistics. */
type Saved = Record<number, SavedPlanStatus>;

function response(aiPlanAvailable = false, saved: Saved = {}): CourseRecommendationsResponse {
  return {
    generated_at: "2026-10-27T10:00:00Z",
    week_start: "2026-10-26",
    ai_plan_available: aiPlanAvailable,
    courses: [
      course(11, "Algorithms", [rec(1, { basis: "history" }), rec(2)], saved[11]),
      course(12, "Physics", [rec(3), rec(4, { basis: "history" })], saved[12]),
      course(13, "Statistics", [rec(5)], saved[13]),
    ],
  };
}

async function renderPage(aiPlanAvailable = false, saved: Saved = {}) {
  vi.mocked(getCourseRecommendations).mockResolvedValue(response(aiPlanAvailable, saved));
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

function section(container: HTMLElement, name: string): HTMLElement {
  return courseToggle(container, name).closest("section")!;
}

/** The weekly plan buttons a course shows, in order. */
function planButtons(container: HTMLElement, name: string): string[] {
  return [...section(container, name).querySelectorAll("button")]
    .map((item) => item.textContent?.trim() ?? "")
    .filter((text) => /weekly plan|Update plan/.test(text));
}

const PLAN: CoursePlan = {
  source: "ai",
  week_start: "2026-10-26",
  intro: "This week, focus on retrieval.",
  items: [],
  throttled: false,
};

function rulesPlan(throttled = false): CoursePlan {
  return { source: "rules", week_start: "2026-10-26", intro: "Here is your rule-based plan.", items: [], throttled };
}

function planResponse(saved: CoursePlan | null, status: SavedPlanStatus | null = current): CoursePlanResponse {
  return {
    saved,
    written_at: status?.written_at ?? null,
    outdated: status?.outdated ?? false,
    new_sessions: status?.new_sessions ?? 0,
    course_changed: status?.course_changed ?? false,
    week_start: "2026-10-26",
  };
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
  vi.mocked(writeCoursePlan).mockReset();
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
    vi.mocked(writeCoursePlan).mockResolvedValue(planResponse(PLAN));
    const container = await renderPage(true);
    const toggle = courseToggle(container, "Statistics");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await click(buttonNamed(section(container, "Statistics"), "Write my weekly plan")!);
    await flush();

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(writeCoursePlan).toHaveBeenCalledWith(13);
    expect(getCoursePlan).not.toHaveBeenCalled();
    expect(section(container, "Statistics").textContent).toContain("This week, focus on retrieval.");
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

describe("Weekly plan controls", () => {
  it("offers 'Write my weekly plan' where nothing was written this week (a new week included)", async () => {
    const container = await renderPage(true, { 12: current });
    expect(planButtons(container, "Algorithms")).toEqual(["Write my weekly plan"]);
    expect(planButtons(container, "Statistics")).toEqual(["Write my weekly plan"]);
    expect(planButtons(container, "Physics")).toEqual(["Show weekly plan"]);
  });

  it("shows a current saved plan with a read, never a write, and offers no update", async () => {
    vi.mocked(getCoursePlan).mockResolvedValue(planResponse(PLAN));
    const container = await renderPage(true, { 11: current });
    expect(planButtons(container, "Algorithms")).toEqual(["Show weekly plan"]);
    expect(section(container, "Algorithms").textContent).not.toContain("since this plan was written");
    expect(getCoursePlan).not.toHaveBeenCalled();

    await click(buttonNamed(container, "Show weekly plan")!);
    await flush();

    expect(getCoursePlan).toHaveBeenCalledWith(11);
    expect(writeCoursePlan).not.toHaveBeenCalled();
    const text = section(container, "Algorithms").textContent!;
    expect(text).toContain("This week, focus on retrieval.");
    expect(text).toContain("Written by AI from your data");
    expect(text).toContain("Written 27 Oct 2026");
    expect(planButtons(container, "Algorithms")).toEqual(["Hide weekly plan"]);

    await click(buttonNamed(container, "Hide weekly plan")!);
    expect(section(container, "Algorithms").textContent).not.toContain("This week, focus on retrieval.");
    expect(planButtons(container, "Algorithms")).toEqual(["Show weekly plan"]);
    expect(getCoursePlan).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ new_sessions: 2, course_changed: false }, "You've logged 2 sessions since this plan was written"],
    [{ new_sessions: 1, course_changed: false }, "You've logged 1 session since this plan was written"],
    [{ new_sessions: 0, course_changed: true }, "You've changed this course's settings since this plan was written"],
    [{ new_sessions: 3, course_changed: true }, "You've logged 3 sessions and changed this course's settings since this plan was written"],
    [{ new_sessions: 1, course_changed: true }, "You've logged 1 session and changed this course's settings since this plan was written"],
  ])("an outdated plan offers Show and Update, with a note (%j)", async (change, note) => {
    const container = await renderPage(true, { 12: { ...current, outdated: true, ...change } });
    expect(planButtons(container, "Physics")).toEqual(["Show weekly plan", "Update plan"]);
    expect(section(container, "Physics").querySelector('[class*="outdatedNote"]')?.textContent).toBe(note);
    expect(planButtons(container, "Algorithms")).toEqual(["Write my weekly plan"]);
    expect(section(container, "Algorithms").textContent).not.toContain("since this plan was written");
  });

  it("keeps the Update button's name distinct for each course", async () => {
    const container = await renderPage(true, { 12: { ...current, outdated: true, new_sessions: 1 } });
    const update = buttonNamed(container, "Update plan")!;
    expect(update.getAttribute("aria-label")).toBe("Update plan for Physics");
    expect(update.getAttribute("aria-label")).toContain(update.textContent!.trim());
  });

  it("writing an update opens the new plan and clears the note and the Update button", async () => {
    const outdated = { ...current, outdated: true, new_sessions: 2 };
    vi.mocked(writeCoursePlan).mockResolvedValue(
      planResponse({ ...PLAN, intro: "A fresh plan." }, { ...current, written_at: "2026-10-28T08:00:00+00:00" }),
    );
    const container = await renderPage(true, { 12: outdated });

    await click(buttonNamed(container, "Update plan")!);
    await flush();

    expect(writeCoursePlan).toHaveBeenCalledWith(12);
    expect(getCoursePlan).not.toHaveBeenCalled();
    const text = section(container, "Physics").textContent!;
    expect(text).toContain("A fresh plan.");
    expect(text).toContain("Written 28 Oct 2026");
    expect(text).not.toContain("since this plan was written");
    expect(planButtons(container, "Physics")).toEqual(["Hide weekly plan"]);
  });

  it("writing a first plan switches that course to the saved controls", async () => {
    vi.mocked(writeCoursePlan).mockResolvedValue(planResponse(PLAN));
    const container = await renderPage(true);
    await click(buttonNamed(section(container, "Algorithms"), "Write my weekly plan")!);
    await flush();
    expect(planButtons(container, "Algorithms")).toEqual(["Hide weekly plan"]);
    expect(planButtons(container, "Physics")).toEqual(["Write my weekly plan"]);
  });

  it("a failed update shows the rules plan with a note and keeps Update available", async () => {
    const outdated = { ...current, outdated: true, new_sessions: 2 };
    vi.mocked(writeCoursePlan).mockResolvedValue(planResponse(rulesPlan(), outdated));
    const container = await renderPage(true, { 12: outdated });

    await click(buttonNamed(container, "Update plan")!);
    await flush();

    const text = section(container, "Physics").textContent!;
    expect(text).toContain("Here is your rule-based plan.");
    expect(text).toContain("Your plan, based on your data");
    expect(text).toContain("The AI plan couldn't be written this time; showing your rule-based plan.");
    expect(text).toContain("You've logged 2 sessions since this plan was written");
    expect(planButtons(container, "Physics")).toEqual(["Show weekly plan", "Update plan"]);
  });

  it("a failed first write keeps 'Write my weekly plan', and says so when AI plans are paused", async () => {
    vi.mocked(writeCoursePlan).mockResolvedValue(planResponse(rulesPlan(true), null));
    const container = await renderPage(true);

    await click(buttonNamed(section(container, "Statistics"), "Write my weekly plan")!);
    await flush();

    const text = section(container, "Statistics").textContent!;
    expect(text).toContain("AI plans are paused for today; showing your rule-based plan.");
    expect(text).not.toContain("couldn't be written this time");
    expect(planButtons(container, "Statistics")).toEqual(["Write my weekly plan"]);
  });

  it("shows the saved plan again after a failed update", async () => {
    const outdated = { ...current, outdated: true, new_sessions: 1 };
    vi.mocked(writeCoursePlan).mockResolvedValue(planResponse(rulesPlan(), outdated));
    vi.mocked(getCoursePlan).mockResolvedValue(planResponse(PLAN, outdated));
    const container = await renderPage(true, { 12: outdated });

    await click(buttonNamed(container, "Update plan")!);
    await flush();
    await click(buttonNamed(section(container, "Physics"), "Show weekly plan")!);
    await flush();

    const text = section(container, "Physics").textContent!;
    expect(text).toContain("This week, focus on retrieval.");
    expect(text).not.toContain("rule-based plan");
  });

  it("reports a failed read and lets the user try again", async () => {
    vi.mocked(getCoursePlan).mockRejectedValue(new Error("Network down"));
    const container = await renderPage(true, { 11: current });

    await click(buttonNamed(container, "Show weekly plan")!);
    await flush();

    expect(section(container, "Algorithms").textContent).toContain("Network down");
    expect(planButtons(container, "Algorithms")).toEqual(["Show weekly plan"]);
  });

  it("shows no plan controls or note when AI plans are off", async () => {
    const container = await renderPage(false, { 12: { ...current, outdated: true, new_sessions: 1 } });
    expect(planButtons(container, "Physics")).toEqual([]);
    expect(container.textContent).not.toContain("since this plan was written");
  });
});

async function violations(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(" | ")}`);
}

describe("Strategies page passes axe", () => {
  it("by default", async () => {
    const container = await renderPage(true, { 12: current });
    expect(await violations(container)).toEqual([]);
  });

  it("with an outdated plan, closed and open", async () => {
    const outdated = { ...current, outdated: true, new_sessions: 2 };
    vi.mocked(getCoursePlan).mockResolvedValue(planResponse(PLAN, outdated));
    const container = await renderPage(true, { 12: outdated, 13: { ...outdated, new_sessions: 0, course_changed: true } });
    expect(await violations(container)).toEqual([]);

    await click(buttonNamed(section(container, "Physics"), "Show weekly plan")!);
    await flush();
    expect(await violations(container)).toEqual([]);
  });
});
