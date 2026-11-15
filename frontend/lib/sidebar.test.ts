// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR,
  readSidebar,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_STORAGE_KEY,
  writeSidebar,
} from "./sidebar";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("clampSidebarWidth", () => {
  it("keeps widths between the minimum and maximum and rounds them", () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(1000)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(260.6)).toBe(261);
  });

  it("falls back to the default for a non-number", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe("readSidebar / writeSidebar", () => {
  it("returns the default when nothing is saved", () => {
    expect(readSidebar()).toEqual(DEFAULT_SIDEBAR);
  });

  it("round-trips a saved layout", () => {
    writeSidebar({ width: 300, collapsed: true });
    expect(readSidebar()).toEqual({ width: 300, collapsed: true });
  });

  it("clamps an out-of-range width on the way in and out", () => {
    writeSidebar({ width: 9999, collapsed: false });
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)!)).toEqual({
      width: SIDEBAR_MAX_WIDTH,
      collapsed: false,
    });
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ width: 10, collapsed: false }));
    expect(readSidebar().width).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("ignores broken or unexpected values", () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "{not json");
    expect(readSidebar()).toEqual(DEFAULT_SIDEBAR);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify("wide"));
    expect(readSidebar()).toEqual(DEFAULT_SIDEBAR);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ width: "300", collapsed: "yes" }));
    expect(readSidebar()).toEqual(DEFAULT_SIDEBAR);
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSidebar()).toEqual(DEFAULT_SIDEBAR);
    expect(() => writeSidebar({ width: 300, collapsed: true })).not.toThrow();
  });
});
