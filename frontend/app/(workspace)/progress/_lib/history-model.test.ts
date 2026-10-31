import { describe, expect, it } from "vitest";

import type { SessionHistoryItem } from "@/lib/api";

import {
  ariaSort,
  DEFAULT_SORT,
  nextSort,
  percentText,
  shortDate,
  SORT_KEYS,
  sortSessions,
  startSort,
  type SortKey,
} from "./history-model";

let nextId = 1;
function session(overrides: Partial<SessionHistoryItem>): SessionHistoryItem {
  return {
    id: nextId++,
    course_name: "CSC 401",
    planned_minutes: 60,
    actual_minutes: 45,
    focus_score: 0.6,
    completion_rate: 0.7,
    adherence_score: 0.75,
    predicted_adherence: 0.7,
    model_version: "",
    created_at: "2026-10-10T10:00:00Z",
    ...overrides,
  };
}

const A = session({ id: 1, course_name: "csc 401", planned_minutes: 60, actual_minutes: 30, adherence_score: 0.5, focus_score: 0.9, predicted_adherence: 0.4, created_at: "2026-10-01T10:00:00Z" });
const B = session({ id: 2, course_name: "MTH 401", planned_minutes: 120, actual_minutes: 120, adherence_score: 1, focus_score: 0.3, predicted_adherence: null, created_at: "2026-10-03T10:00:00Z" });
const C = session({ id: 3, course_name: "BIO 101", planned_minutes: 30, actual_minutes: 24, adherence_score: 0.8, focus_score: 0.6, predicted_adherence: 0.9, created_at: "2026-10-02T10:00:00Z" });
const ITEMS = [A, B, C];

const ids = (items: SessionHistoryItem[]) => items.map((item) => item.id);

describe("sortSessions", () => {
  it("sorts every column in both directions", () => {
    const expected: Record<SortKey, { asc: number[]; desc: number[] }> = {
      date: { asc: [1, 3, 2], desc: [2, 3, 1] },
      course: { asc: [3, 1, 2], desc: [2, 1, 3] }, // BIO, csc, MTH, ignoring case
      planned: { asc: [3, 1, 2], desc: [2, 1, 3] },
      actual: { asc: [3, 1, 2], desc: [2, 1, 3] },
      adherence: { asc: [1, 3, 2], desc: [2, 3, 1] },
      focus: { asc: [2, 3, 1], desc: [1, 3, 2] },
      forecast: { asc: [1, 3, 2], desc: [3, 1, 2] }, // B has no forecast and stays last either way
    };
    for (const key of SORT_KEYS) {
      expect(ids(sortSessions(ITEMS, { key, direction: "asc" })), `${key} asc`).toEqual(expected[key].asc);
      expect(ids(sortSessions(ITEMS, { key, direction: "desc" })), `${key} desc`).toEqual(expected[key].desc);
    }
  });

  it("does not change the list it was given", () => {
    const copy = [...ITEMS];
    sortSessions(ITEMS, { key: "adherence", direction: "asc" });
    expect(ITEMS).toEqual(copy);
  });

  it("keeps sessions without a forecast last, even when sorting from the lowest", () => {
    const none = session({ id: 10, predicted_adherence: null });
    const low = session({ id: 11, predicted_adherence: 0.1 });
    expect(ids(sortSessions([none, low], { key: "forecast", direction: "asc" }))).toEqual([11, 10]);
    expect(ids(sortSessions([none, low], { key: "forecast", direction: "desc" }))).toEqual([11, 10]);
  });

  it("breaks ties newest first and is stable between calls", () => {
    const first = session({ id: 20, adherence_score: 0.5 });
    const second = session({ id: 21, adherence_score: 0.5 });
    const third = session({ id: 22, adherence_score: 0.5 });
    const once = ids(sortSessions([first, third, second], { key: "adherence", direction: "asc" }));
    expect(once).toEqual([22, 21, 20]);
    expect(ids(sortSessions([second, first, third], { key: "adherence", direction: "desc" }))).toEqual([22, 21, 20]);
  });

  it("sorts courses ignoring case and treats an unreadable date as the oldest", () => {
    const odd = session({ id: 30, created_at: "not a date" });
    expect(ids(sortSessions([A, odd], { key: "date", direction: "asc" }))).toEqual([30, 1]);
  });

  it("handles an empty list", () => {
    expect(sortSessions([], DEFAULT_SORT)).toEqual([]);
  });
});

describe("nextSort and ariaSort", () => {
  it("starts on newest first", () => {
    expect(DEFAULT_SORT).toEqual({ key: "date", direction: "desc" });
  });

  it("flips the direction of the sorted column", () => {
    expect(nextSort({ key: "date", direction: "desc" }, "date")).toEqual({ key: "date", direction: "asc" });
    expect(nextSort({ key: "date", direction: "asc" }, "date")).toEqual({ key: "date", direction: "desc" });
  });

  it("starts a new column in its natural order", () => {
    expect(nextSort(DEFAULT_SORT, "course")).toEqual({ key: "course", direction: "asc" });
    expect(nextSort(DEFAULT_SORT, "adherence")).toEqual({ key: "adherence", direction: "desc" });
    expect(startSort("forecast")).toEqual({ key: "forecast", direction: "desc" });
  });

  it("marks only the sorted column", () => {
    const state = { key: "adherence" as const, direction: "asc" as const };
    expect(ariaSort(state, "adherence")).toBe("ascending");
    expect(ariaSort({ ...state, direction: "desc" }, "adherence")).toBe("descending");
    expect(ariaSort(state, "date")).toBe("none");
  });
});

describe("percentText", () => {
  it("rounds a 0 to 1 score and shows n/a when there is none", () => {
    expect(percentText(0.824)).toBe("82%");
    expect(percentText(1.3)).toBe("100%");
    expect(percentText(0)).toBe("0%");
    expect(percentText(null)).toBe("n/a");
    expect(percentText(undefined)).toBe("n/a");
  });
});

describe("shortDate", () => {
  it("is day, month, year in UK order", () => {
    expect(shortDate("2026-10-27T12:00:00Z")).toBe("27 Oct 2026");
  });

  it("shows the day in the given zone", () => {
    expect(shortDate("2026-10-27T23:30:00Z", "Africa/Lagos")).toBe("28 Oct 2026");
    expect(shortDate("2026-10-27T23:30:00Z", "America/Los_Angeles")).toBe("27 Oct 2026");
  });

  it("is empty for an invalid date", () => {
    expect(shortDate("not a date")).toBe("");
  });
});
