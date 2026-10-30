// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, type Course, type CourseInput, type TraitSuggestion } from "@/lib/api";
import { blur, byLabel, cleanup, click, flush, render, selectOption, submit, typeInto } from "@/test/dom";

import { CourseForm, DEMAND_CAP_HINT, SUGGESTED_NOTE } from "./CourseForm";

afterEach(cleanup);

const SUGGESTION: TraitSuggestion = {
  source: "keywords",
  learning_demands: ["problem_solving"],
  builds_on_earlier: true,
  assessment_format: "timed_problem_exam",
  throttled: false,
};

type Props = Partial<Parameters<typeof CourseForm>[0]>;

async function mount(props: Props = {}) {
  const onSubmit = vi.fn<(input: CourseInput) => Promise<void>>(async () => undefined);
  const suggest = vi.fn<(name: string) => Promise<TraitSuggestion>>(async () => SUGGESTION);
  const view = await render(<CourseForm formId="form" onSubmit={onSubmit} suggest={suggest} {...props} />);
  const form = view.container.querySelector("form") as HTMLFormElement;
  return { ...view, form, onSubmit, suggest };
}

const nameInput = (container: HTMLElement) => byLabel(container, "Course name") as HTMLInputElement;
const checkbox = (container: HTMLElement, label: string) => byLabel(container, label) as HTMLInputElement;
const radio = (container: HTMLElement, group: string, label: string) =>
  [...container.querySelectorAll<HTMLElement>(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`)].find(
    (item) => item.textContent === label,
  ) as HTMLElement;
const text = (container: HTMLElement) => container.textContent ?? "";

describe("CourseForm: structure", () => {
  it("labels every control and groups the demands in a fieldset with a legend", async () => {
    const { container } = await mount();
    expect(nameInput(container).required).toBe(true);
    expect(byLabel(container, "How is it assessed?").tagName).toBe("SELECT");
    expect((byLabel(container, "Exam date") as HTMLInputElement).type).toBe("date");
    const fieldset = container.querySelector("fieldset");
    expect(fieldset?.querySelector("legend")?.textContent).toBe("What does it ask of you?");
    expect(fieldset?.querySelectorAll("input[type=checkbox]")).toHaveLength(5);
    expect(container.querySelector('[role="radiogroup"][aria-label="Difficulty"]')).not.toBeNull();
    expect(container.querySelector('[role="radiogroup"][aria-label="Builds on earlier topics"]')).not.toBeNull();
  });

  it("offers Not set in the assessment select and starts on difficulty 3, Not sure", async () => {
    const { container } = await mount();
    const select = byLabel(container, "How is it assessed?") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.options[0].textContent).toBe("Not set");
    expect(radio(container, "Difficulty", "3").getAttribute("aria-checked")).toBe("true");
    expect(radio(container, "Builds on earlier topics", "Not sure").getAttribute("aria-checked")).toBe("true");
  });

  it("puts focus in the name field", async () => {
    vi.useFakeTimers();
    try {
      const { container } = await mount();
      await vi.advanceTimersByTimeAsync(5);
      expect(document.activeElement).toBe(nameInput(container));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CourseForm: validation", () => {
  it("does not submit without a name and shows the error on the field", async () => {
    const { container, form, onSubmit } = await mount();
    await submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(text(container)).toContain("Enter a course name.");
    expect(nameInput(container).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(nameInput(container));
  });

  it("rejects a whitespace-only name and a name over 120 characters", async () => {
    const { container, form, onSubmit } = await mount();
    await typeInto(nameInput(container), "    ");
    await submit(form);
    expect(text(container)).toContain("Enter a course name.");
    await typeInto(nameInput(container), "x".repeat(121));
    await submit(form);
    expect(text(container)).toContain("Use 120 characters or fewer.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("limits the name field to 120 characters", async () => {
    const { container } = await mount();
    expect(nameInput(container).maxLength).toBe(120);
  });

  it("submits the filled-in form as an API payload", async () => {
    const { container, form, onSubmit } = await mount();
    await typeInto(nameInput(container), "  MTH 210 Calculus ");
    await click(radio(container, "Difficulty", "5"));
    await click(checkbox(container, "Writing"));
    await click(radio(container, "Builds on earlier topics", "No"));
    await selectOption(byLabel(container, "How is it assessed?") as HTMLSelectElement, "essay_exam");
    await typeInto(byLabel(container, "Exam date") as HTMLInputElement, "2027-01-20");
    await submit(form);
    expect(onSubmit).toHaveBeenCalledWith({
      name: "MTH 210 Calculus",
      difficulty: 5,
      learning_demands: ["writing"],
      builds_on_earlier: false,
      assessment_format: "essay_exam",
      exam_date: "2027-01-20",
    });
  });
});

describe("CourseForm: the 3-demand cap", () => {
  it("blocks a fourth demand with a hint, and unticking frees a place", async () => {
    const { container } = await mount();
    for (const label of ["Problem solving", "Conceptual understanding", "Writing"]) {
      await click(checkbox(container, label));
    }
    expect(text(container)).not.toContain(DEMAND_CAP_HINT);

    await click(checkbox(container, "Practical work"));
    expect(checkbox(container, "Practical work").checked).toBe(false);
    expect(text(container)).toContain(DEMAND_CAP_HINT);
    const ticked = [...container.querySelectorAll<HTMLInputElement>("fieldset input:checked")];
    expect(ticked).toHaveLength(3);

    await click(checkbox(container, "Writing"));
    await click(checkbox(container, "Practical work"));
    expect(checkbox(container, "Practical work").checked).toBe(true);
    expect(checkbox(container, "Writing").checked).toBe(false);
  });
});

describe("CourseForm: suggestions", () => {
  it("fills untouched fields when the name loses focus and says so", async () => {
    const { container, suggest, onSubmit } = await mount();
    await typeInto(nameInput(container), "MTH 210 Calculus");
    await blur(nameInput(container));
    await flush();
    expect(suggest).toHaveBeenCalledWith("MTH 210 Calculus");
    expect(checkbox(container, "Problem solving").checked).toBe(true);
    expect(radio(container, "Builds on earlier topics", "Yes").getAttribute("aria-checked")).toBe("true");
    expect((byLabel(container, "How is it assessed?") as HTMLSelectElement).value).toBe("timed_problem_exam");
    expect(text(container)).toContain(SUGGESTED_NOTE);
    expect(onSubmit).not.toHaveBeenCalled(); // a suggestion is never saved by itself
  });

  it("does not overwrite fields the user already changed", async () => {
    const { container } = await mount();
    await click(checkbox(container, "Writing"));
    await click(radio(container, "Builds on earlier topics", "No"));
    await typeInto(nameInput(container), "ENG 101 Composition");
    await blur(nameInput(container));
    await flush();
    expect(checkbox(container, "Writing").checked).toBe(true);
    expect(checkbox(container, "Problem solving").checked).toBe(false);
    expect(radio(container, "Builds on earlier topics", "No").getAttribute("aria-checked")).toBe("true");
    expect((byLabel(container, "How is it assessed?") as HTMLSelectElement).value).toBe("timed_problem_exam");
  });

  it("shows no note when every suggested field was already touched", async () => {
    const { container } = await mount();
    await click(checkbox(container, "Writing"));
    await click(radio(container, "Builds on earlier topics", "No"));
    await selectOption(byLabel(container, "How is it assessed?") as HTMLSelectElement, "coursework");
    await typeInto(nameInput(container), "ENG 101");
    await blur(nameInput(container));
    await flush();
    expect(text(container)).not.toContain(SUGGESTED_NOTE);
    expect((byLabel(container, "How is it assessed?") as HTMLSelectElement).value).toBe("coursework");
  });

  it("looks up a name once per change, not on every blur", async () => {
    const { container, suggest } = await mount();
    await typeInto(nameInput(container), "MTH 210");
    await blur(nameInput(container));
    await blur(nameInput(container));
    await flush();
    expect(suggest).toHaveBeenCalledTimes(1);
    await typeInto(nameInput(container), "MTH 211");
    await blur(nameInput(container));
    await flush();
    expect(suggest).toHaveBeenCalledTimes(2);
  });

  it("does not look up an empty name on blur", async () => {
    const { container, suggest } = await mount();
    await blur(nameInput(container));
    await flush();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("looks up again from the Suggest from name button", async () => {
    const { container, suggest } = await mount();
    await typeInto(nameInput(container), "MTH 210");
    await blur(nameInput(container));
    await flush();
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Suggest from name") as HTMLButtonElement;
    await click(button);
    await flush();
    expect(suggest).toHaveBeenCalledTimes(2);
  });

  it("disables Suggest from name until there is a name", async () => {
    const { container } = await mount();
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Suggest from name") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await typeInto(nameInput(container), "MTH 210");
    expect(button.disabled).toBe(false);
  });

  it("ignores a lookup that finishes after a newer one", async () => {
    const resolvers: Array<(value: TraitSuggestion) => void> = [];
    const suggest = vi.fn(() => new Promise<TraitSuggestion>((resolve) => resolvers.push(resolve)));
    const { container } = await mount({ suggest });
    await typeInto(nameInput(container), "First");
    await blur(nameInput(container));
    await typeInto(nameInput(container), "Second");
    await blur(nameInput(container));
    resolvers[1]({ ...SUGGESTION, learning_demands: ["writing"], builds_on_earlier: null, assessment_format: null });
    await flush();
    resolvers[0]({ ...SUGGESTION, learning_demands: ["practical"] });
    await flush();
    expect(checkbox(container, "Writing").checked).toBe(true);
    expect(checkbox(container, "Practical work").checked).toBe(false);
  });

  it("carries on quietly when the lookup fails", async () => {
    const suggest = vi.fn(async () => {
      throw new Error("offline");
    });
    const { container } = await mount({ suggest });
    await typeInto(nameInput(container), "MTH 210");
    await blur(nameInput(container));
    await flush();
    expect(text(container)).not.toContain("offline");
    expect(text(container)).not.toContain(SUGGESTED_NOTE);
  });
});

describe("CourseForm: editing", () => {
  const SAVED: Course = {
    id: 3,
    name: "CSC 401",
    difficulty: 4,
    learning_demands: ["writing"],
    builds_on_earlier: null,
    assessment_format: "",
    exam_date: "2027-01-20",
    weekly_target_hours: 6,
    created_at: "",
    updated_at: "",
  };

  it("starts from the saved values", async () => {
    const { container } = await mount({ course: SAVED });
    expect(nameInput(container).value).toBe("CSC 401");
    expect(radio(container, "Difficulty", "4").getAttribute("aria-checked")).toBe("true");
    expect(checkbox(container, "Writing").checked).toBe(true);
    expect((byLabel(container, "Exam date") as HTMLInputElement).value).toBe("2027-01-20");
  });

  it("says the plan keeps its hours once difficulty changes, and drops the note when it is put back", async () => {
    const { container } = await mount({ course: SAVED });
    expect(text(container)).not.toContain("keeps its hours");
    await click(radio(container, "Difficulty", "5"));
    expect(text(container)).toContain("This week's plan keeps its hours until you update it in Planner.");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/planner");
    await click(radio(container, "Difficulty", "4"));
    expect(text(container)).not.toContain("keeps its hours");
  });

  it("gives no plan note when adding a course", async () => {
    const { container } = await mount();
    await click(radio(container, "Difficulty", "5"));
    expect(text(container)).not.toContain("keeps its hours");
  });

  it("does not look the name up again until it changes", async () => {
    const { container, suggest } = await mount({ course: SAVED });
    await blur(nameInput(container));
    await flush();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("after a rename, fills only the traits the course did not have", async () => {
    const { container } = await mount({ course: SAVED });
    await typeInto(nameInput(container), "CSC 402");
    await blur(nameInput(container));
    await flush();
    expect(checkbox(container, "Writing").checked).toBe(true); // saved answer kept
    expect(checkbox(container, "Problem solving").checked).toBe(false);
    expect(radio(container, "Builds on earlier topics", "Yes").getAttribute("aria-checked")).toBe("true"); // was unanswered
    expect((byLabel(container, "How is it assessed?") as HTMLSelectElement).value).toBe("timed_problem_exam");
  });
});

describe("CourseForm: server errors", () => {
  it("shows a field error under the matching field and moves focus to it", async () => {
    const error = new ApiError(400, 'Name: You already have a course named "CSC 401".', {
      name: ['You already have a course named "CSC 401".'],
    });
    const onSubmit = vi.fn(async () => {
      throw error;
    });
    const { container, form } = await mount({ onSubmit });
    await typeInto(nameInput(container), "csc 401");
    await submit(form);
    await flush();
    expect(text(container)).toContain('You already have a course named "CSC 401".');
    expect(nameInput(container).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(nameInput(container));
    expect(container.querySelector('[role="alert"]')).toBeNull(); // not duplicated in a notice
  });

  it("shows other errors in a notice with the message as given", async () => {
    const onSubmit = vi.fn(async () => {
      throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
    });
    const { container, form } = await mount({ onSubmit });
    await typeInto(nameInput(container), "MTH 210");
    await submit(form);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Can't reach the server. Check your connection and try again.");
  });

  it("maps the exam date error and keeps what the user typed", async () => {
    const onSubmit = vi.fn(async () => {
      throw new ApiError(400, "Exam Date: Date has wrong format.", { exam_date: ["Date has wrong format."] });
    });
    const { container, form } = await mount({ onSubmit });
    await typeInto(nameInput(container), "MTH 210");
    await submit(form);
    await flush();
    expect(text(container)).toContain("Date has wrong format.");
    expect(nameInput(container).value).toBe("MTH 210");
  });
});
