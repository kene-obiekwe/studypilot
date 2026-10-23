import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
  ApiError,
  generatePlan,
  getPlanHistory,
  loginUser,
  NETWORK_ERROR_MESSAGE,
  registerUser,
  SERVER_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  setSessionExpiredHandler,
  toApiError,
} from "./api";
import { getAccessToken, getRefreshToken, setSession } from "./session";

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

type Call = { path: string; auth: string | null };
type Handler = (call: Call) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const TOKEN_INVALID = { detail: "Given token not valid for any token type", code: "token_not_valid" };
const PLAN = { total_available_hours: 10, courses: [{ name: "CSC 401", difficulty: 3 }] };

let calls: Call[];
let redirect: Mock<() => void>;
let restoreHandler: () => void;
let assign: Mock<(url: string) => void>;

function serve(handler: Handler): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const call = { path: new URL(url).pathname.replace(/^\/api/, ""), auth: headers.Authorization ?? null };
      calls.push(call);
      return handler(call);
    }),
  );
}

const refreshCalls = () => calls.filter((call) => call.path === "/auth/token/refresh/");

beforeEach(() => {
  calls = [];
  assign = vi.fn<(url: string) => void>();
  vi.stubGlobal("window", {
    localStorage: new MemoryStorage(),
    location: { pathname: "/planner", search: "?week=2", assign },
  });
  redirect = vi.fn<() => void>();
  restoreHandler = setSessionExpiredHandler(redirect);
});

afterEach(() => {
  restoreHandler();
  vi.unstubAllGlobals();
});

describe("error mapping", () => {
  it("joins the first message of each field under a title-cased label", () => {
    const error = toApiError(400, {
      password: ["This password is too common.", "This password is entirely numeric."],
      total_available_hours: ["A valid number is required."],
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("Password: This password is too common. Total Available Hours: A valid number is required.");
    expect(error.fieldErrors.password).toEqual(["This password is too common.", "This password is entirely numeric."]);
  });

  it("uses detail and non_field_errors text as-is", () => {
    expect(toApiError(401, { detail: "No active account found with the given credentials" }).message).toBe(
      "No active account found with the given credentials",
    );
    expect(toApiError(400, { non_field_errors: ["Passwords do not match."] }).message).toBe("Passwords do not match.");
  });

  it("explains throttling with Retry-After when present", () => {
    expect(toApiError(429, { detail: "Request was throttled." }, "37").message).toBe(
      "Too many attempts. Please wait 37 seconds and try again.",
    );
    expect(toApiError(429, {}, "1").message).toBe("Too many attempts. Please wait 1 second and try again.");
    expect(toApiError(429, {}).message).toBe("Too many attempts. Please wait a moment and try again.");
  });

  it("falls back to DRF's throttle text when Retry-After is hidden by CORS", () => {
    expect(toApiError(429, { detail: "Request was throttled. Expected available in 52 seconds." }).message).toBe(
      "Too many attempts. Please wait 52 seconds and try again.",
    );
    expect(toApiError(429, { detail: "Request was throttled. Expected available in 9 seconds." }, "3").message).toBe(
      "Too many attempts. Please wait 3 seconds and try again.",
    );
  });

  it("hides server error bodies", () => {
    expect(toApiError(500, "<html>Traceback</html>").message).toBe(SERVER_ERROR_MESSAGE);
    expect(toApiError(503, { detail: "upstream" }).message).toBe(SERVER_ERROR_MESSAGE);
  });

  it("falls back to a sentence for empty or HTML 4xx bodies", () => {
    expect(toApiError(404, "<!doctype html><h1>Not Found</h1>").message).toBe(
      "The request couldn't be completed (error 404).",
    );
  });

  it("maps responses and network failures through request()", async () => {
    serve(() => json(429, { detail: "Request was throttled. Expected available in 12 seconds." }, { "Retry-After": "12" }));
    await expect(loginUser({ username: "a", password: "b" })).rejects.toMatchObject({
      status: 429,
      message: "Too many attempts. Please wait 12 seconds and try again.",
    });

    serve(() => json(400, { password: ["This password is too common."] }));
    await expect(registerUser({ username: "a", email: "a@b.c", password: "password123" })).rejects.toMatchObject({
      message: "Password: This password is too common.",
      fieldErrors: { password: ["This password is too common."] },
    });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(getPlanHistory()).rejects.toMatchObject({ status: 0, message: NETWORK_ERROR_MESSAGE });
  });
});

describe("session refresh", () => {
  it("shares one refresh between concurrent 401s and retries both once", async () => {
    setSession({ access: "old", refresh: "r1" });
    serve(async ({ path, auth }) => {
      if (path === "/auth/token/refresh/") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(200, { access: "new" });
      }
      if (auth !== "Bearer new") return json(401, TOKEN_INVALID);
      return path === "/planner/generate/" ? json(200, { allocations: [] }) : json(200, { items: [] });
    });

    const [plan, history] = await Promise.all([generatePlan(PLAN), getPlanHistory()]);

    expect(plan).toEqual({ allocations: [] });
    expect(history).toEqual({ items: [] });
    expect(refreshCalls()).toHaveLength(1);
    expect(calls.filter((call) => call.auth === "Bearer old")).toHaveLength(2);
    expect(calls.filter((call) => call.auth === "Bearer new")).toHaveLength(2);
    expect(getAccessToken()).toBe("new");
    expect(getRefreshToken()).toBe("r1");
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([401, 400])("clears the session and redirects once when refresh returns %i", async (status) => {
    setSession({ access: "old", refresh: "expired" });
    serve(({ path }) =>
      path === "/auth/token/refresh/" ? json(status, { detail: "Token is invalid or expired" }) : json(401, TOKEN_INVALID),
    );

    const results = await Promise.allSettled([generatePlan(PLAN), getPlanHistory()]);

    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toMatchObject({ status: 401, message: SESSION_EXPIRED_MESSAGE });
    }
    expect(refreshCalls()).toHaveLength(1);
    expect(getAccessToken()).toBe("");
    expect(getRefreshToken()).toBe("");
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("expires an access-only session without trying to refresh", async () => {
    window.localStorage.setItem("fyp_access_token", "legacy");
    serve(() => json(401, TOKEN_INVALID));

    await expect(getPlanHistory()).rejects.toMatchObject({ message: SESSION_EXPIRED_MESSAGE });
    expect(refreshCalls()).toHaveLength(0);
    expect(getAccessToken()).toBe("");
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("retries only once: a second 401 after refreshing ends the session", async () => {
    setSession({ access: "old", refresh: "r1" });
    serve(({ path }) => (path === "/auth/token/refresh/" ? json(200, { access: "new" }) : json(401, TOKEN_INVALID)));

    await expect(getPlanHistory()).rejects.toMatchObject({ message: SESSION_EXPIRED_MESSAGE });
    expect(calls.filter((call) => call.path === "/planner/history/")).toHaveLength(2);
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("keeps the session when refresh fails for a transient reason", async () => {
    setSession({ access: "old", refresh: "r1" });
    serve(({ path }) => (path === "/auth/token/refresh/" ? json(503, {}) : json(401, TOKEN_INVALID)));

    await expect(getPlanHistory()).rejects.toMatchObject({ status: 503, message: SERVER_ERROR_MESSAGE });
    expect(getRefreshToken()).toBe("r1");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("never refreshes for login or register, and sends them no bearer token", async () => {
    setSession({ access: "stale", refresh: "r1" });
    serve(() => json(401, { detail: "No active account found with the given credentials" }));

    await expect(loginUser({ username: "a", password: "wrong" })).rejects.toMatchObject({
      status: 401,
      message: "No active account found with the given credentials",
    });
    await expect(registerUser({ username: "a", email: "a@b.c", password: "x" })).rejects.toMatchObject({
      status: 401,
    });

    expect(refreshCalls()).toHaveLength(0);
    expect(calls.every((call) => call.auth === null)).toBe(true);
    expect(getRefreshToken()).toBe("r1");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("never refreshes the refresh call itself", async () => {
    setSession({ access: "old", refresh: "r1" });
    serve(({ path }) => (path === "/auth/token/refresh/" ? json(401, TOKEN_INVALID) : json(401, TOKEN_INVALID)));

    await expect(getPlanHistory()).rejects.toMatchObject({ message: SESSION_EXPIRED_MESSAGE });
    expect(refreshCalls()).toHaveLength(1);
    expect(refreshCalls()[0].auth).toBeNull();
  });

  it("redirects to the sign-in page with the current path by default", async () => {
    restoreHandler();
    restoreHandler = () => {};
    window.localStorage.setItem("fyp_access_token", "legacy");
    serve(() => json(401, TOKEN_INVALID));

    await expect(getPlanHistory()).rejects.toBeInstanceOf(ApiError);
    expect(assign).toHaveBeenCalledWith("/auth?next=%2Fplanner%3Fweek%3D2&reason=expired");
  });
});
