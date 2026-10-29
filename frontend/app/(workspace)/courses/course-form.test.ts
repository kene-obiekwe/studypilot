import { describe, expect, it } from "vitest";

import type { Course } from "@/lib/api";

import {
  applySuggestion,
  buildsOnToApi,
  describeTraits,
  emptyForm,
  formFromCourse,
  formToInput,
  initialTouched,
  MAX_DEMANDS,
  toggleDemand,
  validateForm,
  weeklyHoursLabel,
  type TouchableField,
} from "./course-form";

const COURSE: Course = {
  id: 1,
  name: "CSC 401",
  difficulty: 4,
  learning_demands: ["problem_solving", "conceptual"],
  builds_on_earlier: true,
  assessment_format: "timed_problem_exam",
  exam_date: "2027-01-20",
  weekly_target_hours: 6,
  created_at: "",
  updated_at: "",
};

describe("toggleDemand", () => {
  it("adds and removes demands", () => {
    const first = toggleDemand([], "writing");
    expect(first).toEqual({ demands: ["writing"], blocked: false });
    expect(toggleDemand(first.demands, "writing")).toEqual({ demands: [], blocked: false });
  });

  it("blocks a fourth demand and leaves the list as it was", () => {
    const full = ["problem_solving", "conceptual", "writing"] as const;
    expect(MAX_DEMANDS).toBe(3);
    expect(toggleDemand(full, "practical")).toEqual({ demands: [...full], blocked: true });
  });

  it("still lets the user untick when the list is full", () => {
    const full = ["problem_solving", "conceptual", "writing"] as const;
    expect(toggleDemand(full, "conceptual")).toEqual({ demands: ["problem_solving", "writing"], blocked: false });
  });
});

describe("validateForm", () => {
  it("needs a name", () => {
    expect(validateForm(emptyForm()).name).toBe("Enter a course name.");
    expect(validateForm({ ...emptyForm(), name: "   " }).name).toBe("Enter a course name.");
  });

  it("caps the name at 120 characters, counting trimmed text", () => {
    expect(validateForm({ ...emptyForm(), name: "x".repeat(121) }).name).toBe("Use 120 characters or fewer.");
    expect(validateForm({ ...emptyForm(), name: ` ${"x".repeat(120)} ` })).toEqual({});
  });

  it("accepts a blank exam date and rejects a malformed one", () => {
    expect(validateForm({ ...emptyForm(), name: "A", examDate: "" })).toEqual({});
    expect(validateForm({ ...emptyForm(), name: "A", examDate: "2027-01-20" })).toEqual({});
    expect(validateForm({ ...emptyForm(), name: "A", examDate: "20/01/2027" }).examDate).toBeTruthy();
  });
});

describe("formToInput and formFromCourse", () => {
  it("maps Yes, No and Not sure to true, false and null", () => {
    expect(buildsOnToApi("yes")).toBe(true);
    expect(buildsOnToApi("no")).toBe(false);
    expect(buildsOnToApi("unsure")).toBeNull();
  });

  it("builds the API payload with a trimmed name and a null for no exam date", () => {
    expect(formToInput({ ...emptyForm(), name: "  MTH 210  " })).toEqual({
      name: "MTH 210",
      difficulty: 3,
      learning_demands: [],
      builds_on_earlier: null,
      assessment_format: "",
      exam_date: null,
    });
  });

  it("round-trips a saved course", () => {
    const input = formToInput(formFromCourse(COURSE));
    expect(input).toEqual({
      name: "CSC 401",
      difficulty: 4,
      learning_demands: ["problem_solving", "conceptual"],
      builds_on_earlier: true,
      assessment_format: "timed_problem_exam",
      exam_date: "2027-01-20",
    });
  });
});

describe("applySuggestion", () => {
  const suggestion = {
    learning_demands: ["problem_solving" as const],
    builds_on_earlier: true,
    assessment_format: "timed_problem_exam" as const,
  };

  it("fills every untouched field", () => {
    const result = applySuggestion(emptyForm(), new Set<TouchableField>(), suggestion);
    expect(result.applied).toBe(true);
    expect(result.state.learningDemands).toEqual(["problem_solving"]);
    expect(result.state.buildsOnEarlier).toBe("yes");
    expect(result.state.assessmentFormat).toBe("timed_problem_exam");
  });

  it("leaves touched fields exactly as the user set them", () => {
    const state = { ...emptyForm(), learningDemands: ["writing" as const], buildsOnEarlier: "no" as const };
    const touched = new Set<TouchableField>(["learningDemands", "buildsOnEarlier"]);
    const result = applySuggestion(state, touched, suggestion);
    expect(result.state.learningDemands).toEqual(["writing"]);
    expect(result.state.buildsOnEarlier).toBe("no");
    expect(result.state.assessmentFormat).toBe("timed_problem_exam");
    expect(result.applied).toBe(true);
  });

  it("reports nothing applied when every field is touched", () => {
    const touched = new Set<TouchableField>(["learningDemands", "buildsOnEarlier", "assessmentFormat"]);
    const state = emptyForm();
    const result = applySuggestion(state, touched, suggestion);
    expect(result.applied).toBe(false);
    expect(result.state).toBe(state);
  });

  it("treats an empty list or null as no suggestion, not as a request to clear", () => {
    const state = { ...emptyForm(), assessmentFormat: "coursework" as const };
    const result = applySuggestion(state, new Set(), {
      learning_demands: [],
      builds_on_earlier: null,
      assessment_format: null,
    });
    expect(result.applied).toBe(false);
    expect(result.state.assessmentFormat).toBe("coursework");
  });

  it("never fills more than 3 demands and never touches difficulty or the exam date", () => {
    const result = applySuggestion({ ...emptyForm(), difficulty: 5, examDate: "2027-01-20" }, new Set(), {
      ...suggestion,
      learning_demands: ["problem_solving", "conceptual", "writing", "practical"],
    });
    expect(result.state.learningDemands).toHaveLength(3);
    expect(result.state.difficulty).toBe(5);
    expect(result.state.examDate).toBe("2027-01-20");
  });
});

describe("initialTouched", () => {
  it("is empty when adding a course", () => {
    expect(initialTouched(undefined).size).toBe(0);
  });

  it("marks answered traits as touched so a rename cannot overwrite them", () => {
    expect([...initialTouched(COURSE)].sort()).toEqual(["assessmentFormat", "buildsOnEarlier", "learningDemands"]);
  });

  it("leaves unanswered traits open to suggestions", () => {
    const bare: Course = { ...COURSE, learning_demands: [], builds_on_earlier: null, assessment_format: "" };
    expect(initialTouched(bare).size).toBe(0);
  });
});

describe("describeTraits and weeklyHoursLabel", () => {
  it("joins the traits with a middle dot", () => {
    expect(describeTraits(COURSE)).toBe("Problem solving · Conceptual understanding · Builds on earlier topics · Timed problem exam");
  });

  it("omits what is not set and prompts when nothing is", () => {
    expect(describeTraits({ learning_demands: [], builds_on_earlier: false, assessment_format: "" })).toBe("No traits set yet");
    expect(describeTraits({ learning_demands: ["writing"], builds_on_earlier: null, assessment_format: "" })).toBe("Writing");
  });

  it("words the weekly target", () => {
    expect(weeklyHoursLabel(3)).toBe("3 h a week");
    expect(weeklyHoursLabel(2.5)).toBe("2.5 h a week");
    expect(weeklyHoursLabel(6.86)).toBe("6.9 h a week");
  });
});
