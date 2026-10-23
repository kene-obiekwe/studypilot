import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { predictAdherence, type ForecastItem } from "./api";
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

const FORECASTS: ForecastItem[] = [
  {
    course_name: "CSC 401",
    status: "ok",
    predicted_adherence: 0.72,
    model_version: "oulad_adherence_forecast@20261022T171713",
    weeks_history: 4,
    features: { adh_lag1: 0.9, adh_lag2: 0.8, adh_mean3: 0.85, adh_trend: 0.1, weeks_history: 4 },
  },
  {
    course_name: "MTH 401",
    status: "insufficient_history",
    predicted_adherence: null,
    model_version: null,
    weeks_history: 1,
    features: { adh_lag1: 1, adh_lag2: null, adh_mean3: 1, adh_trend: null, weeks_history: 1 },
  },
];

type Sent = { url: string; method: string; body: string | undefined; auth: string | undefined };
let sent: Sent[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal("window", { localStorage: new MemoryStorage(), location: { pathname: "/", search: "", assign: vi.fn() } });
  setSession({ access: "access-token", refresh: "refresh-token" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      sent.push({ url, method: String(init.method), body: init.body as string | undefined, auth: headers.Authorization });
      return new Response(JSON.stringify(FORECASTS), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("predictAdherence", () => {
  it("posts an empty body when no course is given", async () => {
    await predictAdherence();
    expect(sent).toHaveLength(1);
    expect(new URL(sent[0].url).pathname).toBe("/api/tracking/predict/");
    expect(sent[0].method).toBe("POST");
    expect(JSON.parse(sent[0].body ?? "null")).toEqual({});
    expect(sent[0].auth).toBe("Bearer access-token");
  });

  it("posts only course_name when a course is given", async () => {
    await predictAdherence("CSC 401");
    expect(JSON.parse(sent[0].body ?? "null")).toEqual({ course_name: "CSC 401" });
  });

  it("treats an empty course name as no course", async () => {
    await predictAdherence("");
    expect(JSON.parse(sent[0].body ?? "null")).toEqual({});
  });

  it("returns the response list unchanged", async () => {
    await expect(predictAdherence()).resolves.toEqual(FORECASTS);
  });

  it("returns an empty list as an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    await expect(predictAdherence()).resolves.toEqual([]);
  });
});
