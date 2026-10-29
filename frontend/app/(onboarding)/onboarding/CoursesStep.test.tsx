// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, createCourse, type Course } from "@/lib/api";
import { courseColor } from "@/lib/course-colors";
import { cleanup, click, flush, render, typeInto } from "@/test/dom";

import { CoursesStep } from "./CoursesStep";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  createCourse: vi.fn(),
  deleteCourse: vi.fn(),
  suggestCourseTraits: vi.fn().mockResolvedValue({}),
}));

const CALCULUS = { id: 1, name: "Calculus", difficulty: 3 } as unknown as Course;

function setup() {
  const onContinue = vi.fn();
  const onAdded = vi.fn();
  const view = (courses: Course[]) => (
    <CoursesStep courses={courses} colorFor={courseColor} onAdded={onAdded} onRemoved={vi.fn()} onContinue={onContinue} />
  );
  return { onContinue, onAdded, view };
}

const nameInput = (container: HTMLElement) => container.querySelector<HTMLInputElement>("input[name='name']")!;
const continueButton = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Continue")!;

beforeEach(() => {
  vi.mocked(createCourse).mockReset();
});
afterEach(cleanup);

describe("CoursesStep Continue", () => {
  it("adds a typed course first, then continues", async () => {
    vi.mocked(createCourse).mockImplementation(async (input) => ({ id: 2, difficulty: 3, ...input }) as unknown as Course);
    const { onAdded, onContinue, view } = setup();
    const { container } = await render(view([CALCULUS]));

    await typeInto(nameInput(container), "History");
    await click(continueButton(container));
    await flush();

    expect(createCourse).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createCourse).mock.calls[0][0]).toMatchObject({ name: "History" });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onAdded.mock.invocationCallOrder[0]).toBeLessThan(onContinue.mock.invocationCallOrder[0]);
  });

  it("stays on the step and shows the error when the add fails", async () => {
    const message = 'You already have a course named "Calculus".';
    vi.mocked(createCourse).mockRejectedValue(new ApiError(400, message, { name: [message] }));
    const { onAdded, onContinue, view } = setup();
    const { container } = await render(view([CALCULUS]));

    await typeInto(nameInput(container), "calculus");
    await click(continueButton(container));
    await flush();

    expect(onAdded).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    expect(container.textContent).toContain(message);
    expect(continueButton(container).getAttribute("aria-busy")).toBeNull();
  });

  it("continues as before when the name is empty", async () => {
    const { onContinue, view } = setup();
    const { container } = await render(view([CALCULUS]));

    await click(continueButton(container));

    expect(createCourse).not.toHaveBeenCalled();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("is disabled with no courses and an empty form, then enabled and adding once a name is typed", async () => {
    vi.mocked(createCourse).mockImplementation(async (input) => ({ id: 1, difficulty: 3, ...input }) as unknown as Course);
    const { onAdded, onContinue, view } = setup();
    const { container } = await render(view([]));
    expect((continueButton(container) as HTMLButtonElement).disabled).toBe(true);

    await typeInto(nameInput(container), "Calculus");
    expect((continueButton(container) as HTMLButtonElement).disabled).toBe(false);

    await click(continueButton(container));
    await flush();

    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows busy while adding and does not submit twice", async () => {
    let finish: (course: Course) => void = () => undefined;
    vi.mocked(createCourse).mockReturnValue(new Promise<Course>((resolve) => (finish = resolve)));
    const { onContinue, view } = setup();
    const { container } = await render(view([CALCULUS]));

    await typeInto(nameInput(container), "History");
    await click(continueButton(container));
    expect(continueButton(container).getAttribute("aria-busy")).toBe("true");
    await click(continueButton(container));
    expect(createCourse).toHaveBeenCalledTimes(1);

    finish({ id: 2, name: "History", difficulty: 3 } as unknown as Course);
    await flush();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
