// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import type { SessionHistoryItem } from "@/lib/api";
import { click, cleanup, render, selectOption } from "@/test/dom";

import { SessionsTable } from "./SessionsTable";

afterEach(cleanup);

function item(id: number, course: string, adherence: number, day: number): SessionHistoryItem {
  return {
    id,
    course_name: course,
    planned_minutes: 60,
    actual_minutes: Math.round(60 * adherence),
    focus_score: 0.5,
    completion_rate: 0.5,
    adherence_score: adherence,
    predicted_adherence: id % 2 ? 0.5 : null,
    model_version: "",
    created_at: `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`,
  };
}

const SESSIONS = [item(1, "CSC 401", 0.5, 1), item(2, "MTH 401", 1, 3), item(3, "BIO 101", 0.8, 2)];

function courseOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody tr")].map((row) => row.querySelector('td[data-label="Course"]')?.textContent?.trim() ?? "");
}

const header = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("th")].find((th) => th.textContent?.trim() === label) as HTMLTableCellElement;

describe("SessionsTable", () => {
  it("starts newest first, with aria-sort on the date column only", async () => {
    const { container } = await render(<SessionsTable sessions={SESSIONS} />);
    expect(courseOrder(container)).toEqual(["MTH 401", "BIO 101", "CSC 401"]);
    expect(header(container, "Date").getAttribute("aria-sort")).toBe("descending");
    expect(header(container, "Course").getAttribute("aria-sort")).toBe("none");
  });

  it("sorts by adherence when its header is clicked, then reverses on a second click", async () => {
    const { container } = await render(<SessionsTable sessions={SESSIONS} />);
    const button = () => header(container, "Adherence").querySelector("button") as HTMLButtonElement;

    await click(button());
    expect(courseOrder(container)).toEqual(["MTH 401", "BIO 101", "CSC 401"]); // highest first
    expect(header(container, "Adherence").getAttribute("aria-sort")).toBe("descending");
    expect(header(container, "Date").getAttribute("aria-sort")).toBe("none");

    await click(button());
    expect(courseOrder(container)).toEqual(["CSC 401", "BIO 101", "MTH 401"]);
    expect(header(container, "Adherence").getAttribute("aria-sort")).toBe("ascending");
  });

  it("sorts courses from A to Z first", async () => {
    const { container } = await render(<SessionsTable sessions={SESSIONS} />);
    await click(header(container, "Course").querySelector("button") as HTMLButtonElement);
    expect(courseOrder(container)).toEqual(["BIO 101", "CSC 401", "MTH 401"]);
    expect(header(container, "Course").getAttribute("aria-sort")).toBe("ascending");
  });

  it("puts sessions without a forecast last in either direction", async () => {
    // Only MTH 401 (id 2) has no forecast; the other two tie, so the newer one comes first.
    const { container } = await render(<SessionsTable sessions={SESSIONS} />);
    const button = header(container, "Forecast").querySelector("button") as HTMLButtonElement;
    await click(button);
    expect(courseOrder(container)).toEqual(["BIO 101", "CSC 401", "MTH 401"]);
    await click(button);
    expect(courseOrder(container)).toEqual(["BIO 101", "CSC 401", "MTH 401"]);
  });

  it("labels every value so the stacked phone layout reads clearly", async () => {
    const { container } = await render(<SessionsTable sessions={[SESSIONS[0]]} />);
    const labels = [...container.querySelectorAll("tbody td")].map((cell) => cell.getAttribute("data-label"));
    expect(labels).toEqual(["Date", "Course", "Planned", "Actual", "Adherence", "Focus", "Forecast"]);
  });

  it("offers the same sorting through the phone control", async () => {
    const { container } = await render(<SessionsTable sessions={SESSIONS} />);
    const select = container.querySelector("select") as HTMLSelectElement;
    await selectOption(select, "adherence");
    expect(courseOrder(container)).toEqual(["MTH 401", "BIO 101", "CSC 401"]);
    expect(header(container, "Adherence").getAttribute("aria-sort")).toBe("descending");
  });

  it("shows the first page and adds more on request", async () => {
    const many = Array.from({ length: 25 }, (_, index) => item(index + 1, `Course ${index + 1}`, 0.5, 1 + (index % 28)));
    const { container } = await render(<SessionsTable sessions={many} pageSize={10} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(container.textContent).toContain("Showing 10 of 25 sessions");

    const more = [...container.querySelectorAll("button")].find((button) => button.textContent === "Show more") as HTMLButtonElement;
    await click(more);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(20);
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "Show more") as HTMLButtonElement);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(25);
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Show more")).toBe(false);
  });

  it("applies the course colour to its dot when given", async () => {
    const { container } = await render(
      <SessionsTable sessions={[SESSIONS[0]]} colorStyle={(name) => (name === "CSC 401" ? ({ "--course-dot": "red" } as React.CSSProperties) : undefined)} />,
    );
    const dot = container.querySelector('td[data-label="Course"] span span') as HTMLElement;
    expect(dot.style.getPropertyValue("--course-dot")).toBe("red");
  });
});
