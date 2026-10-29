import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  getPlan,
  listPlans,
  PlanChangedError,
  PlanExistsError,
  previewPlan,
  savePlan,
  type WeeklyPlanInput,
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

type Sent = { method: string; path: string; body: unknown };

let sent: Sent[];

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({
        method: init.method ?? "GET",
        path: new URL(url).pathname.replace(/^\/api/, "") + new URL(url).search,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
}

const FIRST: WeeklyPlanInput = { courses: [{ name: "A", difficulty: 4 }], total_hours: 10, base_revision: null };
const UPDATE: WeeklyPlanInput = { courses: [{ name: "A", difficulty: 5 }], more_hours: 6, base_revision: 2 };

beforeEach(() => {
  sent = [];
  vi.stubGlobal("window", { localStorage: new MemoryStorage(), location: { pathname: "/planner", search: "", assign: vi.fn() } });
  setSession({ access: "token", refresh: "refresh" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("weekly plan requests", () => {
  it("lists the current plan of each week", async () => {
    respond(200, { items: [{ id: 1, week_start: "2026-10-26", revision: 2, revision_count: 2 }] });
    const plans = await listPlans(5);
    expect(plans).toHaveLength(1);
    expect(plans[0].revision).toBe(2);
    expect(sent[0]).toMatchObject({ method: "GET", path: "/planner/plans/?limit=5" });
  });

  it("lists without a limit by default", async () => {
    respond(200, { items: [] });
    await listPlans();
    expect(sent[0].path).toBe("/planner/plans/");
  });

  it("gets a week's plan, with or without its older revisions", async () => {
    respond(200, { id: 3, week_start: "2026-10-26", days_left: 5 });
    expect((await getPlan("2026-10-26"))?.days_left).toBe(5);
    await getPlan("2026-10-26", { revisions: true });
    expect(sent.map((call) => call.path)).toEqual(["/planner/plans/2026-10-26/", "/planner/plans/2026-10-26/?revisions=1"]);
  });

  it("returns null when the week has no plan", async () => {
    respond(404, { detail: "No plan for this week." });
    await expect(getPlan("2026-10-26")).resolves.toBeNull();
  });

  it("lets other errors through when getting a plan", async () => {
    respond(400, { week_start: ["Use YYYY-MM-DD."] });
    await expect(getPlan("tomorrow")).rejects.toBeInstanceOf(ApiError);
  });

  it("previews with the week in the body and saves with PUT to the week's path", async () => {
    respond(200, { week_start: "2026-10-26", base_revision: 2, days_left: 5, clamped: false, plan_json: {} });
    await previewPlan("2026-10-26", UPDATE);
    respond(200, { id: 9, days_left: 5 });
    await savePlan("2026-10-26", FIRST);
    expect(sent).toEqual([
      { method: "POST", path: "/planner/plans/preview/", body: { week_start: "2026-10-26", ...UPDATE } },
      { method: "PUT", path: "/planner/plans/2026-10-26/", body: FIRST },
    ]);
  });
});

describe("weekly plan conflicts", () => {
  const changed = { code: "plan_changed", detail: "This week's plan changed since you opened it.", current_revision: 3 };
  const exists = { code: "plan_exists", detail: "You already have a plan for this week.", current_revision: 1 };

  it("maps 409 plan_changed to PlanChangedError on save and preview", async () => {
    respond(409, changed);
    const saving = savePlan("2026-10-26", UPDATE);
    await expect(saving).rejects.toBeInstanceOf(PlanChangedError);
    await expect(saving).rejects.toMatchObject({ status: 409, code: "plan_changed", message: changed.detail });
    await expect(previewPlan("2026-10-26", UPDATE)).rejects.toBeInstanceOf(PlanChangedError);
  });

  it("maps 409 plan_exists to PlanExistsError", async () => {
    respond(409, exists);
    const saving = savePlan("2026-10-26", FIRST);
    await expect(saving).rejects.toBeInstanceOf(PlanExistsError);
    await expect(saving).rejects.toMatchObject({ code: "plan_exists", message: exists.detail });
  });

  it("keeps the typed errors usable as ApiError", async () => {
    respond(409, changed);
    await expect(savePlan("2026-10-26", UPDATE)).rejects.toBeInstanceOf(ApiError);
  });

  it("leaves other failures as plain ApiError", async () => {
    respond(400, { more_hours: ["Ensure this value is less than or equal to 168."] });
    const failure = savePlan("2026-10-26", UPDATE);
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.not.toBeInstanceOf(PlanChangedError);
    respond(409, { detail: "Something else." });
    await expect(savePlan("2026-10-26", UPDATE)).rejects.not.toBeInstanceOf(PlanChangedError);
  });
});
