import { describe, expect, it } from "vitest";

import { activeDestination, isActive, NAV_ITEMS, pageTitle } from "./nav";

describe("navigation", () => {
  it("lists the five destinations in order", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual(["/home", "/courses", "/planner", "/strategies", "/progress"]);
    expect(NAV_ITEMS.map((item) => item.label)).toEqual(["This week", "Courses", "Planner", "Strategies", "Progress"]);
    for (const item of NAV_ITEMS) expect(item.shortLabel.length).toBeLessThanOrEqual(10);
  });

  it("marks a destination active on its path and its sub-routes", () => {
    expect(isActive("/progress", "/progress")).toBe(true);
    expect(isActive("/progress/log", "/progress")).toBe(true);
    expect(isActive("/progress/", "/progress")).toBe(true);
    expect(isActive("/progressive", "/progress")).toBe(false);
    expect(isActive("/planner", "/progress")).toBe(false);
    expect(isActive(null, "/home")).toBe(false);
  });

  it("finds exactly one active destination per workspace route", () => {
    for (const path of ["/home", "/courses", "/planner", "/strategies", "/progress", "/progress/history"]) {
      expect(NAV_ITEMS.filter((item) => isActive(path, item.href))).toHaveLength(1);
    }
    expect(activeDestination("/progress/predict")?.href).toBe("/progress");
    expect(activeDestination("/styleguide")).toBeUndefined();
  });

  it("titles pages, including progress sub-routes", () => {
    expect(pageTitle("/home")).toBe("This week");
    expect(pageTitle("/strategies")).toBe("Strategies");
    expect(pageTitle("/progress")).toBe("Progress");
    expect(pageTitle("/progress/log")).toBe("Log a session");
    expect(pageTitle("/progress/history/")).toBe("History");
    expect(pageTitle("/unknown")).toBe("StudyPilot");
  });
});
