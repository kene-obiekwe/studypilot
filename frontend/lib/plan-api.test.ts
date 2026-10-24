import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, getCoursePlan, suggestCourseTraits, type CoursePlan, type TraitSuggestion } from "./api";
import { setSession } from "./session";

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const AI_PLAN: CoursePlan = {
  source: "ai",
  week_start: "2026-10-19",
  intro: "A focused week for Calculus.",
  items: [{ strategy_id: "split_long_sessions", title: "Split long sessions", body: "Your 90+ minute sessions..." }],
  throttled: false,
  model: "claude-haiku-5-5",
};

type Sent = { path: string; method: string; body: string | undefined; auth: string | undefined };
let sent: Sent[];

function serve(respond: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      sent.push({
        path: new URL(url).pathname.replace(/^\/api/, ""),
        method: String(init.method),
        body: init.body as string | undefined,
        auth: headers.Authorization,
      });
      return respond();
    }),
  );
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  sent = [];
  vi.stubGlobal("window", {
    localStorage: new MemoryStorage(),
    location: { pathname: "/", search: "", assign: vi.fn() },
  });
  setSession({ access: "access-token", refresh: "refresh-token" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("course plan client", () => {
  it("gets the plan for one course", async () => {
    serve(() => ok(AI_PLAN));
    await expect(getCoursePlan(7)).resolves.toEqual(AI_PLAN);
    expect(sent).toEqual([
      { path: "/recommendations/courses/7/plan/", method: "GET", body: undefined, auth: "Bearer access-token" },
    ]);
  });

  it("passes a rules-only plan through unchanged", async () => {
    const rules: CoursePlan = {
      source: "rules",
      week_start: AI_PLAN.week_start,
      intro: "Based on 8 sessions over 4 weeks. Here is your plan for Calculus this week.",
      items: AI_PLAN.items,
      throttled: true,
    };
    serve(() => ok(rules));
    const plan = await getCoursePlan(7);
    expect(plan.source).toBe("rules");
    expect(plan.throttled).toBe(true);
    expect(plan.model).toBeUndefined();
  });

  it("surfaces another user's course as a 404", async () => {
    serve(() => ok({ detail: "Course not found." }, 404));
    const error = await getCoursePlan(99).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });
});

describe("trait suggestion client", () => {
  it("posts the course name and returns the suggestion", async () => {
    const suggestion: TraitSuggestion = {
      source: "keywords",
      learning_demands: ["problem_solving"],
      builds_on_earlier: true,
      assessment_format: null,
      throttled: false,
    };
    serve(() => ok(suggestion));
    await expect(suggestCourseTraits("MTH 201 Calculus")).resolves.toEqual(suggestion);
    expect(sent[0]).toMatchObject({ path: "/planner/courses/suggest-traits/", method: "POST", auth: "Bearer access-token" });
    expect(JSON.parse(sent[0].body ?? "null")).toEqual({ name: "MTH 201 Calculus" });
  });

  it("surfaces validation errors readably", async () => {
    serve(() => ok({ name: ["This field may not be blank."] }, 400));
    const error = await suggestCourseTraits("").catch((e: unknown) => e);
    expect((error as ApiError).message).toBe("Name: This field may not be blank.");
  });
});
