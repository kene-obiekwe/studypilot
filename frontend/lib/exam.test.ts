import { describe, expect, it } from "vitest";

import { daysUntilExam, examLabel } from "./exam";

const NOON = new Date(2026, 9, 25, 12, 0, 0); // 25 Oct 2026, local noon

describe("daysUntilExam", () => {
  it("is 0 on the day itself, whatever the time of day", () => {
    expect(daysUntilExam("2026-10-25", NOON)).toBe(0);
    expect(daysUntilExam("2026-10-25", new Date(2026, 9, 25, 0, 0, 1))).toBe(0);
    expect(daysUntilExam("2026-10-25", new Date(2026, 9, 25, 23, 59, 59))).toBe(0);
  });

  it("counts whole calendar days ahead", () => {
    expect(daysUntilExam("2026-10-26", NOON)).toBe(1);
    expect(daysUntilExam("2026-11-12", NOON)).toBe(18);
    expect(daysUntilExam("2027-10-25", NOON)).toBe(365);
  });

  it("returns null for a past exam, no date or an invalid date", () => {
    expect(daysUntilExam("2026-10-24", NOON)).toBeNull();
    expect(daysUntilExam(null, NOON)).toBeNull();
    expect(daysUntilExam("", NOON)).toBeNull();
    expect(daysUntilExam("25/10/2026", NOON)).toBeNull();
    expect(daysUntilExam("2027-02-31", NOON)).toBeNull();
  });

  it("is not thrown off by a clock change between now and the exam", () => {
    expect(daysUntilExam("2026-11-02", new Date(2026, 9, 25, 12))).toBe(8);
    expect(daysUntilExam("2027-03-29", new Date(2027, 2, 20, 23, 30))).toBe(9);
  });
});

describe("examLabel", () => {
  it("words the badge", () => {
    expect(examLabel("2026-10-25", NOON)).toBe("Exam today");
    expect(examLabel("2026-10-26", NOON)).toBe("Exam in 1 day");
    expect(examLabel("2026-11-12", NOON)).toBe("Exam in 18 days");
  });

  it("shows nothing for past or missing dates", () => {
    expect(examLabel("2026-10-01", NOON)).toBeNull();
    expect(examLabel(null, NOON)).toBeNull();
  });
});

describe("in an explicit zone", () => {
  const KIRITIMATI = "Pacific/Kiritimati";
  const LAGOS = "Africa/Lagos";
  const LA = "America/Los_Angeles";

  it("is 0 on the exam day in Kiritimati while UTC is still the day before", () => {
    const now = new Date("2026-11-01T10:30:00Z"); // Monday 2 Nov 00:30 in Kiritimati
    expect(daysUntilExam("2026-11-02", now, KIRITIMATI)).toBe(0);
    expect(daysUntilExam("2026-11-02", now, "UTC")).toBe(1);
    expect(examLabel("2026-11-02", now, KIRITIMATI)).toBe("Exam today");
    expect(examLabel("2026-11-02", now, "UTC")).toBe("Exam in 1 day");
  });

  it("treats yesterday's exam as passed in the zone where the day is over", () => {
    const now = new Date("2026-11-01T10:30:00Z");
    expect(daysUntilExam("2026-11-01", now, KIRITIMATI)).toBeNull();
    expect(daysUntilExam("2026-11-01", now, "UTC")).toBe(0);
  });

  it("counts from Lagos's Monday just after Sunday 23:00Z, not Los Angeles's Sunday", () => {
    const now = new Date("2026-11-01T23:30:00Z");
    expect(daysUntilExam("2026-11-02", now, LAGOS)).toBe(0);
    expect(daysUntilExam("2026-11-02", now, LA)).toBe(1);
  });

  it("is not thrown off by a clock change in the zone", () => {
    expect(daysUntilExam("2026-11-02", new Date("2026-10-25T12:00:00Z"), "Europe/London")).toBe(8);
    expect(daysUntilExam("2027-03-29", new Date("2027-03-20T23:30:00Z"), "Europe/London")).toBe(9);
  });
});
