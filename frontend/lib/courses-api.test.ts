import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, createCourse, deleteCourse, listCourses, updateCourse, type Course } from "./api";
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

const COURSE: Course = {
  id: 7,
  name: "CSC 401",
  difficulty: 4,
  learning_demands: ["problem_solving", "conceptual"],
  builds_on_earlier: true,
  assessment_format: "timed_problem_exam",
  exam_date: "2027-01-20",
  weekly_target_hours: 3,
  created_at: "2026-10-23T10:00:00Z",
  updated_at: "2026-10-23T10:00:00Z",
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

describe("course client", () => {
  it("listCourses gets the list and returns it unchanged", async () => {
    serve(() => ok([COURSE]));
    await expect(listCourses()).resolves.toEqual([COURSE]);
    expect(sent).toEqual([{ path: "/planner/courses/", method: "GET", body: undefined, auth: "Bearer access-token" }]);
  });

  it("createCourse posts the payload as JSON", async () => {
    serve(() => ok(COURSE, 201));
    const payload = { name: "CSC 401", difficulty: 4, learning_demands: ["problem_solving" as const] };
    await expect(createCourse(payload)).resolves.toEqual(COURSE);
    expect(sent[0].path).toBe("/planner/courses/");
    expect(sent[0].method).toBe("POST");
    expect(JSON.parse(sent[0].body ?? "null")).toEqual(payload);
  });

  it("updateCourse patches only the fields it is given, at the course id", async () => {
    serve(() => ok({ ...COURSE, name: "CSC 402" }));
    const updated = await updateCourse(7, { name: "CSC 402" });
    expect(updated.name).toBe("CSC 402");
    expect(sent[0].path).toBe("/planner/courses/7/");
    expect(sent[0].method).toBe("PATCH");
    expect(JSON.parse(sent[0].body ?? "null")).toEqual({ name: "CSC 402" });
  });

  it("updateCourse can send null and empty values to clear traits", async () => {
    serve(() => ok(COURSE));
    await updateCourse(7, { builds_on_earlier: null, exam_date: null, assessment_format: "", learning_demands: [] });
    expect(JSON.parse(sent[0].body ?? "null")).toEqual({
      builds_on_earlier: null,
      exam_date: null,
      assessment_format: "",
      learning_demands: [],
    });
  });

  it("deleteCourse sends DELETE with no body and resolves on an empty 204", async () => {
    serve(() => new Response(null, { status: 204 }));
    await expect(deleteCourse(7)).resolves.toBeUndefined();
    expect(sent).toEqual([
      { path: "/planner/courses/7/", method: "DELETE", body: undefined, auth: "Bearer access-token" },
    ]);
  });

  it("surfaces validation errors as a readable ApiError", async () => {
    serve(() => ok({ name: ['You already have a course named "CSC 401".'] }, 400));
    const error = await createCourse({ name: "csc 401" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe('Name: You already have a course named "CSC 401".');
    expect((error as ApiError).fieldErrors.name).toEqual(['You already have a course named "CSC 401".']);
  });

  it("surfaces a 404 as an ApiError", async () => {
    serve(() => ok({ detail: "No Course matches the given query." }, 404));
    const error = await updateCourse(99, { difficulty: 2 }).catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(404);
  });
});
