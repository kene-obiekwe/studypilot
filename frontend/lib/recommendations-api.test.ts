import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  getCourseRecommendations,
  sendStrategyFeedback,
  type CourseRecommendationsResponse,
} from "./api";
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

const RESPONSE: CourseRecommendationsResponse = {
  generated_at: "2026-10-24T12:00:00Z",
  week_start: "2026-10-19",
  ai_plan_available: false,
  courses: [
    {
      course: {
        id: 7,
        name: "Calculus",
        difficulty: 5,
        learning_demands: ["problem_solving"],
        builds_on_earlier: true,
        assessment_format: "timed_problem_exam",
        exam_date: "2026-11-11",
      },
      evidence: {
        basis: "history",
        summary: "Based on 8 sessions over 4 weeks",
        window_days: 28,
        sessions: 8,
        total_sessions: 8,
        study_days: 5,
        weeks: 4,
        mean_adherence: 0.7,
        mean_completion: 0.54,
        mean_focus: 0.65,
        forecast: { status: "ok", predicted_adherence: 0.68, weeks_history: 4 },
        exam_in_days: 18,
        plan: null,
        diagnostics: ["exam_soon", "long_sessions_finish_poorly", "sparse_spacing"],
      },
      recommendations: [
        {
          shown_id: 41,
          strategy_id: "split_long_sessions",
          kind: "schedule",
          priority: 30,
          basis: "history",
          title: "Split long sessions into shorter ones",
          what: "Keep the same total study time, but spread it over shorter sessions on different days.",
          how: ["Replace each 90-minute session with 3 sessions of 30 minutes on different days."],
          why: "Your 90+ minute sessions averaged 35% completion (4 sessions), against 72% for shorter ones (4).",
          triggers: ["long_sessions_finish_poorly"],
          facts: { n_long: 4, n_short: 4, n_blocks: 3, block_minutes: 30 },
          source: { citation: "Cepeda et al. (2006) ...", short: "Cepeda et al., 2006" },
          feedback: { rating: null, tried: false },
        },
      ],
    },
  ],
};

type Sent = { path: string; search: string; method: string; body: string | undefined; auth: string | undefined };
let sent: Sent[];

function serve(respond: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      const headers = (init.headers ?? {}) as Record<string, string>;
      sent.push({
        path: parsed.pathname.replace(/^\/api/, ""),
        search: parsed.search,
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

describe("course recommendations client", () => {
  it("gets every course's recommendations with the bearer token", async () => {
    serve(() => ok(RESPONSE));
    await expect(getCourseRecommendations()).resolves.toEqual(RESPONSE);
    expect(sent).toEqual([
      { path: "/recommendations/courses/", search: "", method: "GET", body: undefined, auth: "Bearer access-token" },
    ]);
  });

  it("filters to one course with course_id", async () => {
    serve(() => ok(RESPONSE));
    await getCourseRecommendations(7);
    expect(sent[0].path).toBe("/recommendations/courses/");
    expect(sent[0].search).toBe("?course_id=7");
  });

  it("keeps course_id 0 rather than dropping it", async () => {
    serve(() => ok({ ...RESPONSE, courses: [] }));
    await getCourseRecommendations(0);
    expect(sent[0].search).toBe("?course_id=0");
  });

  it("surfaces an unknown course as a 404 ApiError", async () => {
    serve(() => ok({ detail: "Course not found." }, 404));
    const error = await getCourseRecommendations(99).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe("Course not found.");
  });
});

describe("strategy feedback client", () => {
  it.each(["helpful", "not_helpful", "tried"] as const)("posts %s with the shown id", async (value) => {
    serve(() => ok({ shown_id: 41, rating: value === "tried" ? null : value, tried: value === "tried" }));
    const state = await sendStrategyFeedback(41, value);
    expect(state.shown_id).toBe(41);
    expect(sent[0]).toMatchObject({ path: "/recommendations/feedback/", method: "POST", auth: "Bearer access-token" });
    expect(JSON.parse(sent[0].body ?? "null")).toEqual({ shown_id: 41, value });
  });

  it("returns the combined feedback state", async () => {
    serve(() => ok({ shown_id: 41, rating: "helpful", tried: true }));
    await expect(sendStrategyFeedback(41, "tried")).resolves.toEqual({ shown_id: 41, rating: "helpful", tried: true });
  });

  it("surfaces validation errors readably", async () => {
    serve(() => ok({ value: ['"love_it" is not a valid choice.'] }, 400));
    const error = await sendStrategyFeedback(41, "helpful").catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('Value: "love_it" is not a valid choice.');
  });

  it("surfaces another user's strategy as a 404", async () => {
    serve(() => ok({ detail: "Strategy not found." }, 404));
    const error = await sendStrategyFeedback(41, "helpful").catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(404);
  });
});
