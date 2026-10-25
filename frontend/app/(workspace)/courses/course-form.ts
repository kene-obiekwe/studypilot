/** Pure logic for the course form: labels, validation, the 3-demand cap and suggestion merging. */

import type {
  AssessmentFormat,
  Course,
  CourseInput,
  LearningDemand,
  TraitSuggestion,
} from "@/lib/api";

export const MAX_NAME_LENGTH = 120;
export const MAX_DEMANDS = 3;

export const DEMAND_OPTIONS: ReadonlyArray<{ value: LearningDemand; label: string }> = [
  { value: "problem_solving", label: "Problem solving" },
  { value: "conceptual", label: "Conceptual understanding" },
  { value: "memorisation", label: "Memorisation" },
  { value: "writing", label: "Writing" },
  { value: "practical", label: "Practical work" },
];

export const FORMAT_OPTIONS: ReadonlyArray<{ value: AssessmentFormat; label: string }> = [
  { value: "timed_problem_exam", label: "Timed problem exam" },
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "essay_exam", label: "Essay exam" },
  { value: "coursework", label: "Coursework" },
  { value: "continuous_quizzes", label: "Continuous quizzes" },
];

export type BuildsOnEarlier = "yes" | "no" | "unsure";

export type CourseFormState = {
  name: string;
  difficulty: number;
  learningDemands: LearningDemand[];
  buildsOnEarlier: BuildsOnEarlier;
  assessmentFormat: AssessmentFormat | "";
  examDate: string;
};

/** The fields a suggestion could fill. Once the user changes one, a suggestion leaves it alone. */
export type SuggestibleField = "learningDemands" | "buildsOnEarlier" | "assessmentFormat";
export type TouchableField = SuggestibleField | "difficulty" | "examDate";

export const DEFAULT_DIFFICULTY = 3;

export function emptyForm(): CourseFormState {
  return {
    name: "",
    difficulty: DEFAULT_DIFFICULTY,
    learningDemands: [],
    buildsOnEarlier: "unsure",
    assessmentFormat: "",
    examDate: "",
  };
}

function buildsOnFromApi(value: boolean | null): BuildsOnEarlier {
  return value === true ? "yes" : value === false ? "no" : "unsure";
}

export function buildsOnToApi(value: BuildsOnEarlier): boolean | null {
  return value === "yes" ? true : value === "no" ? false : null;
}

export function formFromCourse(course: Course): CourseFormState {
  return {
    name: course.name,
    difficulty: course.difficulty,
    learningDemands: [...course.learning_demands],
    buildsOnEarlier: buildsOnFromApi(course.builds_on_earlier),
    assessmentFormat: course.assessment_format,
    examDate: course.exam_date ?? "",
  };
}

/**
 * Fields that already hold an answer count as touched, so renaming a saved course never has a
 * suggestion overwrite what the user set before.
 */
export function initialTouched(course: Course | undefined): Set<TouchableField> {
  const touched = new Set<TouchableField>();
  if (!course) {
    return touched;
  }
  if (course.learning_demands.length > 0) touched.add("learningDemands");
  if (course.builds_on_earlier !== null) touched.add("buildsOnEarlier");
  if (course.assessment_format !== "") touched.add("assessmentFormat");
  return touched;
}

/** Add or remove a demand. A 4th is refused (`blocked`) and the list is returned unchanged. */
export function toggleDemand(
  demands: ReadonlyArray<LearningDemand>,
  demand: LearningDemand,
): { demands: LearningDemand[]; blocked: boolean } {
  if (demands.includes(demand)) {
    return { demands: demands.filter((item) => item !== demand), blocked: false };
  }
  if (demands.length >= MAX_DEMANDS) {
    return { demands: [...demands], blocked: true };
  }
  return { demands: [...demands, demand], blocked: false };
}

export type FormErrors = Partial<Record<"name" | "examDate", string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateForm(state: CourseFormState): FormErrors {
  const errors: FormErrors = {};
  const name = state.name.trim();
  if (!name) {
    errors.name = "Enter a course name.";
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `Use ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  if (state.examDate && !DATE_PATTERN.test(state.examDate)) {
    errors.examDate = "Enter the date as day, month and year.";
  }
  return errors;
}

export function formToInput(state: CourseFormState): CourseInput {
  return {
    name: state.name.trim(),
    difficulty: state.difficulty,
    learning_demands: state.learningDemands,
    builds_on_earlier: buildsOnToApi(state.buildsOnEarlier),
    assessment_format: state.assessmentFormat,
    exam_date: state.examDate || null,
  };
}

/**
 * Pre-fill from a suggestion, but only fields the user has not touched and only with real
 * answers (an empty list or null means "no suggestion", not "clear this field").
 * `applied` is true when at least one field changed.
 */
export function applySuggestion(
  state: CourseFormState,
  touched: ReadonlySet<TouchableField>,
  suggestion: Pick<TraitSuggestion, "learning_demands" | "builds_on_earlier" | "assessment_format">,
): { state: CourseFormState; applied: boolean } {
  const next = { ...state };
  let applied = false;

  if (!touched.has("learningDemands") && suggestion.learning_demands.length > 0) {
    next.learningDemands = suggestion.learning_demands.slice(0, MAX_DEMANDS);
    applied = true;
  }
  if (!touched.has("buildsOnEarlier") && suggestion.builds_on_earlier !== null) {
    next.buildsOnEarlier = buildsOnFromApi(suggestion.builds_on_earlier);
    applied = true;
  }
  if (!touched.has("assessmentFormat") && suggestion.assessment_format) {
    next.assessmentFormat = suggestion.assessment_format;
    applied = true;
  }
  return { state: applied ? next : state, applied };
}

/** "Problem solving · Builds on earlier topics · Timed problem exam", or a prompt when nothing is set. */
export function describeTraits(course: Pick<Course, "learning_demands" | "builds_on_earlier" | "assessment_format">): string {
  const parts: string[] = course.learning_demands.map(
    (demand) => DEMAND_OPTIONS.find((option) => option.value === demand)?.label ?? demand,
  );
  if (course.builds_on_earlier === true) {
    parts.push("Builds on earlier topics");
  }
  if (course.assessment_format) {
    parts.push(FORMAT_OPTIONS.find((option) => option.value === course.assessment_format)?.label ?? course.assessment_format);
  }
  return parts.length > 0 ? parts.join(" · ") : "No traits set yet";
}

/** "6 h a week", "2.5 h a week". */
export function weeklyHoursLabel(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} h a week`;
}
