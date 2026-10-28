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

// The page action renders into the app shell's header slot, which isn't mounted here; tests submit the form.
vi.mock("@/components/app-shell", () => ({ PageAction: () => null }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listCourses: vi.fn(),
    listPlans: vi.fn(),
    getSessionHistory: vi.fn(),
    getPlan: vi.fn(),
    previewPlan: vi.fn(),
    savePlan: vi.fn(),
  };
});

vi.mock("@/lib/timer-refresh", () => ({ notifySessionsChanged: vi.fn() }));

import {
  ApiError,
  getPlan,
  getSessionHistory,
  listCourses,
  listPlans,
  PlanChangedError,
  previewPlan,
  savePlan,
  type Course,
  type PlanCourseEntry,
  type PlanPreview,
  type SessionHistoryItem,
  type WeeklyPlan,
  type WeeklyPlanDetail,
} from "@/lib/api";
import { notifySessionsChanged } from "@/lib/timer-refresh";
import { byLabel, cleanup, click, flush, render, selectOption, submit, typeInto } from "@/test/dom";

import PlannerPage from "./page";

// Wednesday 28 Oct 2026 (week of Mon 26 Oct); Saturday 31 Oct; Sunday 1 Nov; Monday 26 Oct.
const WEDNESDAY = new Date(2026, 9, 28, 10, 0);
const SATURDAY = new Date(2026, 9, 31, 10, 0);
const SUNDAY = new Date(2026, 10, 1, 20, 0);
const MONDAY = new Date(2026, 9, 26, 9, 0);

const course = (id: number, name: string, difficulty: number): Course => ({
  id,
  name,
  difficulty,
  learning_demands: [],
  builds_on_earlier: null,
  assessment_format: "",
  exam_date: null,
  weekly_target_hours: 3,
  created_at: "",
  updated_at: "",
});

function entry(name: string, planned: number, overrides: Partial<PlanCourseEntry> = {}): PlanCourseEntry {
  return {
    course_id: null,
    name,
    difficulty: 3,
    factor: 1,
    adjustment_source: "none",
    adherence_estimate: null,
    entered_on: "2026-10-26",
    logged_at_revision: 0,
    remaining_at_revision: planned,
    planned_hours: planned,
    focus_block_minutes: 50,
    break_minutes: 10,
    ...overrides,
  };
}

function plan(
  revision: number,
  courses: PlanCourseEntry[],
  json: Partial<WeeklyPlan["plan_json"]> = {},
  overrides: Partial<WeeklyPlan> = {},
): WeeklyPlan {
  const total = courses.reduce((sum, item) => sum + item.planned_hours, 0);
  return {
    id: revision * 10,
    week_start: "2026-10-26",
    revision,
    revision_count: revision,
    is_current: true,
    superseded_at: null,
    created_at: "2026-10-26T09:00:00Z",
    updated_at: "2026-10-26T09:00:00Z",
    plan_json: {
      version: 2,
      mode: revision === 1 ? "first" : "update",
      made_on: "2026-10-26",
      total_hours: total,
      more_hours: total,
      counted_hours: 0,
      clamped: false,
      courses,
      removed: [],
      total_available_hours: total,
      allocations: [],
      ...json,
    },
    ...overrides,
  };
}

let sessionId = 0;
function session(name: string, hours: number, at = "2026-10-27T10:00:00"): SessionHistoryItem {
  return {
    id: ++sessionId,
    course_name: name,
    planned_minutes: 50,
    actual_minutes: hours * 60,
    focus_score: 4,
    completion_rate: 1,
    adherence_score: 1,
    predicted_adherence: null,
    model_version: "",
    created_at: new Date(at).toISOString(),
  };
}

const COURSES = [course(1, "A", 4), course(2, "B", 2), course(3, "C", 2)];
// The note's start: A 7 h / B 3 h, logged A 4 h, B 1 h.
const START = plan(1, [entry("A", 7, { course_id: 1, difficulty: 4 }), entry("B", 3, { course_id: 2, difficulty: 2 })]);
const LOGS = [session("A", 3), session("A", 1, "2026-10-28T08:00:00"), session("B", 1)];

// Example 1 after saving: A 10 h (4 done), C 4 h, B removed with 1 h logged.
const EXAMPLE_1_JSON: Partial<WeeklyPlan["plan_json"]> = {
  made_on: "2026-10-28",
  total_hours: 14,
  more_hours: 10,
  counted_hours: 4,
  removed: [{ course_id: 2, name: "B", removed_on: "2026-10-28", logged_hours: 1 }],
};
const EXAMPLE_1_COURSES = [
  entry("A", 10, { course_id: 1, difficulty: 5, logged_at_revision: 4, remaining_at_revision: 6 }),
  entry("C", 4, { course_id: 3, difficulty: 2, entered_on: "2026-10-28" }),
];

/** What the mocked server holds: the current plans, and earlier revisions by week. */
type Server = { courses: Course[]; plans: WeeklyPlan[]; older: Record<string, WeeklyPlan[]>; sessions: SessionHistoryItem[] };
let server: Server;

function detail(week: string): WeeklyPlanDetail | null {
  const current = server.plans.find((item) => item.week_start === week);
  return current ? { ...current, days_left: 5, revisions: server.older[week] ?? [] } : null;
}

function serve(state: Partial<Server>) {
  server = { courses: COURSES, plans: [], older: {}, sessions: LOGS, ...state };
  vi.mocked(listCourses).mockImplementation(async () => server.courses);
  vi.mocked(listPlans).mockImplementation(async () => server.plans);
  vi.mocked(getSessionHistory).mockImplementation(async () => ({ items: server.sessions }));
  vi.mocked(getPlan).mockImplementation(async (week: string) => detail(week));
}

function previewOf(week: string, base: number | null, json: Partial<WeeklyPlan["plan_json"]>, courses: PlanCourseEntry[]): PlanPreview {
  return { week_start: week, base_revision: base, days_left: 5, clamped: false, plan_json: plan(base ? base + 1 : 1, courses, json).plan_json };
}

async function renderPage() {
  const rendered = await render(<PlannerPage />);
  await flush();
  await flush();
  return rendered.container;
}

function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = buttonNamed(container, text);
  if (!found) throw new Error(`No button "${text}"`);
  return found;
}

const form = (container: HTMLElement) => container.querySelector<HTMLFormElement>("#plan-form")!;
const text = (container: HTMLElement) => (container.textContent ?? "").replace(/\s+/g, " ");

function tableRows(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("th, td")].map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
}

async function violations(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

/** Example 1 on the update form: B out, C in at difficulty 2, A made harder, 10 more hours. */
async function enterExample1(container: HTMLElement) {
  await click(button(container, "Update this week's plan"));
  await click(container.querySelector<HTMLButtonElement>('[aria-label="Remove B from this plan"]')!);
  await selectOption(container.querySelector<HTMLSelectElement>('select[aria-label="Difficulty of A"]')!, "5");
  await click(button(container, "Add a course"));
  await typeInto(container.querySelector<HTMLInputElement>('input[aria-label="Course name"]')!, "C");
  await selectOption(container.querySelector<HTMLSelectElement>('select[aria-label="Difficulty of C"]')!, "2");
  await typeInto(byLabel(container, "How many more hours can you study this week?") as HTMLInputElement, "10");
}

const EXAMPLE_1_PREVIEW = previewOf("2026-10-26", 1, EXAMPLE_1_JSON, EXAMPLE_1_COURSES);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: WEDNESDAY });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(previewPlan).mockReset();
  vi.mocked(savePlan).mockReset();
  vi.mocked(getPlan).mockReset();
  vi.mocked(notifySessionsChanged).mockReset();
});

describe("Planner, first plan of the week", () => {
  it("asks for the week's total and previews it as a first plan", async () => {
    serve({ sessions: [] });
    const container = await renderPage();
    expect(text(container)).toContain("No plan for this week yet.");
    expect(text(container)).toContain("Split your available hours across your courses.");
    const hours = byLabel(container, "How many hours can you study this week?") as HTMLInputElement;
    expect(hours.value).toBe("12");
    expect(container.querySelector('input[type="radio"]')).toBeNull();

    vi.mocked(previewPlan).mockResolvedValue(previewOf("2026-10-26", null, {}, [entry("A", 6), entry("B", 3), entry("C", 3)]));
    await submit(form(container));
    await flush();
    expect(previewPlan).toHaveBeenCalledWith("2026-10-26", {
      courses: [
        { name: "A", difficulty: 4 },
        { name: "B", difficulty: 2 },
        { name: "C", difficulty: 2 },
      ],
      total_hours: 12,
      base_revision: null,
    });
    expect(savePlan).not.toHaveBeenCalled();
    expect(text(container)).toContain("Check the new split");
  });

  it("explains a total outside 1 to 168 before asking the server", async () => {
    serve({ sessions: [] });
    const container = await renderPage();
    await typeInto(byLabel(container, "How many hours can you study this week?") as HTMLInputElement, "0");
    await submit(form(container));
    expect(text(container)).toContain("Enter a number of hours from 1 to 168.");
    expect(previewPlan).not.toHaveBeenCalled();
  });
});

describe("Planner, this week's plan", () => {
  it("shows the week's card: total, days left and each course's hours", async () => {
    serve({ plans: [START] });
    const container = await renderPage();
    const card = container.querySelector('[aria-labelledby="this-week-title"]') as HTMLElement;
    expect(text(card)).toContain("This week's plan");
    expect(text(card)).toContain("5 of 10 h");
    expect(text(card)).toContain("5 days left (Wed–Sun)");
    expect(text(card)).toContain("A4 of 7 h · 3 h left");
    expect(text(card)).toContain("B1 of 3 h · 2 h left");
    expect(container.querySelector("#plan-form")).toBeNull();
  });

  it("opens the update form asking how many more hours, next to the days left", async () => {
    serve({ plans: [START] });
    const container = await renderPage();
    await click(button(container, "Update this week's plan"));
    const more = byLabel(container, "How many more hours can you study this week?") as HTMLInputElement;
    expect(more.value).toBe("5");
    expect(text(container)).toContain("5 days left this week, Wed–Sun");
    expect(text(container)).toContain("Already done this week: 5 h on courses in the plan.");

    // Leaving B out: its hour no longer counts, so the default and the help follow.
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Remove B from this plan"]')!);
    expect(more.value).toBe("6");
    expect(text(container)).toContain("Already done this week: 4 h on courses in the plan.");
  });

  it("example 1: previews Course · Done · New plan · Left this week", async () => {
    serve({ plans: [START] });
    const container = await renderPage();
    await enterExample1(container);
    vi.mocked(previewPlan).mockResolvedValue(EXAMPLE_1_PREVIEW);
    await submit(form(container));
    await flush();

    expect(previewPlan).toHaveBeenCalledWith("2026-10-26", {
      courses: [
        { name: "A", difficulty: 5 },
        { name: "C", difficulty: 2 },
      ],
      more_hours: 10,
      base_revision: 1,
    });
    expect([...container.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
      "Course",
      "Done",
      "New plan",
      "Left this week",
    ]);
    expect(tableRows(container)).toEqual([
      ["A", "4 h", "10 h", "6 h left"],
      ["C", "0", "4 h", "4 h left (new)"],
      ["B", "removed", "1 h not counted"],
    ]);
    expect(text(container)).toContain("New total 14 h (4 done + 10 more)");
    expect(form(container).querySelector("fieldset")?.disabled).toBe(true);
    expect(savePlan).not.toHaveBeenCalled();

    await click(button(container, "Back to editing"));
    expect(container.querySelector("tbody")).toBeNull();
    expect(form(container).querySelector("fieldset")?.disabled).toBe(false);
  });

  it("example 3a: says which course is past its share", async () => {
    serve({ plans: [START] });
    const container = await renderPage();
    await click(button(container, "Update this week's plan"));
    await selectOption(container.querySelector<HTMLSelectElement>('select[aria-label="Difficulty of A"]')!, "3");
    await selectOption(container.querySelector<HTMLSelectElement>('select[aria-label="Difficulty of B"]')!, "3");
    await typeInto(byLabel(container, "How many more hours can you study this week?") as HTMLInputElement, "1");
    vi.mocked(previewPlan).mockResolvedValue(
      previewOf("2026-10-26", 1, { total_hours: 6, more_hours: 1, counted_hours: 5 }, [
        entry("A", 4, { logged_at_revision: 4, remaining_at_revision: 0 }),
        entry("B", 2, { logged_at_revision: 1, remaining_at_revision: 1 }),
      ]),
    );
    await submit(form(container));
    await flush();
    expect(tableRows(container)).toEqual([
      ["A", "4 h", "4 h", "Done for this week"],
      ["B", "1 h", "2 h", "1 h left"],
    ]);
    expect(text(container)).toContain("A is already past its share; it gets no more hours this week.");
    expect(text(container)).toContain("New total 6 h (5 done + 1 more)");
  });

  it("saves against the revision it opened, then shows the new plan on the card", async () => {
    serve({ plans: [START] });
    const container = await renderPage();
    await enterExample1(container);
    vi.mocked(previewPlan).mockResolvedValue(EXAMPLE_1_PREVIEW);
    await submit(form(container));
    await flush();

    const saved = plan(2, EXAMPLE_1_COURSES, EXAMPLE_1_JSON);
    vi.mocked(savePlan).mockImplementation(async () => {
      server.plans = [saved];
      server.older = { "2026-10-26": [{ ...START, is_current: false }] };
      return { ...saved, days_left: 5 };
    });
    await click(button(container, "Save this plan"));
    await flush();
    await flush();

    expect(savePlan).toHaveBeenCalledWith("2026-10-26", {
      courses: [
        { name: "A", difficulty: 5 },
        { name: "C", difficulty: 2 },
      ],
      more_hours: 10,
      base_revision: 1,
    });
    expect(notifySessionsChanged).toHaveBeenCalled();
    expect(text(container)).toContain("This week's plan is saved.");
    const card = container.querySelector('[aria-labelledby="this-week-title"]') as HTMLElement;
    expect(text(card)).toContain("4 of 14 h");
    expect(text(card)).toContain("A4 of 10 h · 6 h left");
    expect(text(card)).toContain("C0 of 4 h · 4 h left");
    expect(text(card)).toContain("No longer in this week's plan: B · 1 h logged (not counted). Sessions stay in your history.");
    expect(text(card)).toContain("Updated once · last Wed 28 Oct");
    expect(container.querySelector("#plan-form")).toBeNull();
  });

  it("after a conflict, refetches the plan and previews again against the new revision", async () => {
    serve({ plans: [START] });
    const container = await renderPage();
    await enterExample1(container);
    vi.mocked(previewPlan).mockResolvedValue(EXAMPLE_1_PREVIEW);
    await submit(form(container));
    await flush();

    // Another tab saved revision 2 in the meantime.
    const other = plan(2, [entry("A", 8, { course_id: 1 }), entry("B", 2, { course_id: 2 })]);
    vi.mocked(savePlan).mockImplementationOnce(async () => {
      server.plans = [other];
      throw new PlanChangedError(new ApiError(409, "This week's plan changed since you opened it.", {}, "plan_changed"));
    });
    vi.mocked(previewPlan).mockResolvedValue({ ...EXAMPLE_1_PREVIEW, base_revision: 2 });
    await click(button(container, "Save this plan"));
    await flush();
    await flush();

    expect(getPlan).toHaveBeenLastCalledWith("2026-10-26", { revisions: true });
    expect(previewPlan).toHaveBeenLastCalledWith("2026-10-26", {
      courses: [
        { name: "A", difficulty: 5 },
        { name: "C", difficulty: 2 },
      ],
      more_hours: 10,
      base_revision: 2,
    });
    expect(text(container)).toContain("This plan changed in another tab. Review the new split before saving.");
    expect(tableRows(container)[0]).toEqual(["A", "4 h", "10 h", "6 h left"]);

    vi.mocked(savePlan).mockResolvedValue({ ...plan(3, EXAMPLE_1_COURSES, EXAMPLE_1_JSON), days_left: 5 });
    await click(button(container, "Save this plan"));
    await flush();
    expect(savePlan).toHaveBeenLastCalledWith("2026-10-26", expect.objectContaining({ base_revision: 2 }));
  });

  it("shows the notice when a course was deleted mid-week", async () => {
    const afterDelete = plan(2, [entry("A", 7, { course_id: 1, logged_at_revision: 4, remaining_at_revision: 3 })], {
      mode: "course_deleted",
      made_on: "2026-10-28",
      removed: [{ course_id: 2, name: "B", removed_on: "2026-10-28", logged_hours: 1 }],
    });
    serve({ courses: [course(1, "A", 4), course(3, "C", 2)], plans: [afterDelete], older: { "2026-10-26": [{ ...START, is_current: false }] } });
    const container = await renderPage();
    expect(text(container)).toContain(
      "You removed B from your courses, so its 2 h left this week were dropped. Update the plan to share them out.",
    );
    // The update starts from the total the user chose (10), less what A has done.
    await click(button(container, "Update this week's plan"));
    expect((byLabel(container, "How many more hours can you study this week?") as HTMLInputElement).value).toBe("6");
  });

  it("marks a course done for the week and the week complete", async () => {
    serve({ plans: [plan(2, [entry("A", 4), entry("B", 1)])] });
    const container = await renderPage();
    expect(text(container)).toContain("Done for this week");
    expect(text(container)).toContain("Week complete.");
    expect(text(container)).toContain("You've done the 5 h you planned. Anything more is a bonus.");
  });
});

describe("Planner, planning ahead", () => {
  it("on Sunday asks which week, with next week as the default", async () => {
    vi.setSystemTime(SUNDAY);
    serve({ plans: [START] });
    const container = await renderPage();
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual([
      "This week (ends today)",
      "Next week (starts Mon 2 Nov)",
    ]);
    expect(radios[1].checked).toBe(true);
    expect(text(container)).toContain("Plan next week");
    expect(byLabel(container, "How many hours can you study next week?")).toBeDefined();

    vi.mocked(previewPlan).mockResolvedValue(previewOf("2026-11-02", null, {}, [entry("A", 8), entry("B", 4)]));
    await submit(form(container));
    await flush();
    expect(previewPlan).toHaveBeenCalledWith("2026-11-02", expect.objectContaining({ total_hours: 12, base_revision: null }));

    // Choosing this week switches to updating it.
    await click(button(container, "Back to editing"));
    await click(radios[0]);
    expect(byLabel(container, "How many more hours can you study this week?")).toBeDefined();
  });

  it("on Saturday plans this week by default, with a link to plan next week", async () => {
    vi.setSystemTime(SATURDAY);
    serve({ plans: [START] });
    const container = await renderPage();
    expect(container.querySelector("#plan-form")).toBeNull();
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    await click(button(container, "Plan next week"));
    expect(byLabel(container, "How many hours can you study next week?")).toBeDefined();
    await click(button(container, "Cancel"));
    expect(container.querySelector("#plan-form")).toBeNull();
  });

  it("offers no next week on a weekday", async () => {
    serve({ plans: [START] });
    const container = await renderPage();
    expect(buttonNamed(container, "Plan next week")).toBeUndefined();
  });

  it("shows next week's plan once there is one", async () => {
    vi.setSystemTime(SUNDAY);
    const next = plan(1, [entry("A", 8), entry("B", 4)], { made_on: "2026-11-01" }, { week_start: "2026-11-02" });
    serve({ plans: [next, START] });
    const container = await renderPage();
    const card = container.querySelector('[aria-labelledby="next-week-title"]') as HTMLElement;
    expect(text(card)).toContain("Next week's plan");
    expect(text(card)).toContain("starts Mon 2 Nov · 12 h");
    await click(card.querySelector<HTMLButtonElement>('[aria-label="Edit next week\'s plan"]')!);
    expect(text(container)).toContain("Update next week's plan");
  });
});

describe("Planner, Monday with no plan", () => {
  it("fills the form from last week's plan as a draft, and saves nothing", async () => {
    vi.setSystemTime(MONDAY);
    const lastWeek = plan(
      1,
      [entry("A", 5, { difficulty: 5 }), entry("B", 4, { difficulty: 3 }), entry("C", 3, { difficulty: 1 })],
      { made_on: "2026-10-19" },
      { week_start: "2026-10-19" },
    );
    serve({ plans: [lastWeek], sessions: [] });
    const container = await renderPage();
    await click(button(container, "Start from last week's plan (12 h, 3 courses)"));

    expect((byLabel(container, "How many hours can you study this week?") as HTMLInputElement).value).toBe("12");
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Difficulty of A"]')?.value).toBe("5");
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Difficulty of C"]')?.value).toBe("1");
    expect(text(container)).toContain("Nothing is saved until you check the preview and save it.");
    expect(buttonNamed(container, "Start from last week's plan (12 h, 3 courses)")).toBeUndefined();
    expect(previewPlan).not.toHaveBeenCalled();
    expect(savePlan).not.toHaveBeenCalled();
  });
});

describe("Planner passes axe", () => {
  it("first plan", async () => {
    serve({ sessions: [] });
    const container = await renderPage();
    expect(await violations(container)).toEqual([]);
  });

  it("this week's card and the update form", async () => {
    serve({ plans: [START] });
    const container = await renderPage();
    await click(button(container, "Update this week's plan"));
    expect(await violations(container)).toEqual([]);
  });

  it("the preview, after a conflict", async () => {
    serve({ plans: [START] });
    const container = await renderPage();
    await enterExample1(container);
    vi.mocked(previewPlan).mockRejectedValueOnce(new PlanChangedError(new ApiError(409, "changed", {}, "plan_changed")));
    vi.mocked(previewPlan).mockResolvedValue(EXAMPLE_1_PREVIEW);
    await submit(form(container));
    await flush();
    await flush();
    expect(text(container)).toContain("This plan changed in another tab.");
    expect(await violations(container)).toEqual([]);
  });

  it("Sunday's week choice", async () => {
    vi.setSystemTime(SUNDAY);
    serve({ plans: [START] });
    const container = await renderPage();
    expect(await violations(container)).toEqual([]);
  });
});
