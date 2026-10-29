import { clearSession, getAccessToken, getRefreshToken, hasSession, setAccessToken } from "./session";

// next.config.js refuses a production build without NEXT_PUBLIC_API_BASE_URL, so this
// fallback only ever applies to `next dev`.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api";

const REFRESH_PATH = "/auth/token/refresh/";

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";
export const SERVER_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";
export const SESSION_EXPIRED_MESSAGE = "Your session expired. Sign in again.";

type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type FieldErrors = Record<string, string[]>;

/** The `code` of the sign-in error returned when the username or email and the password are right but the email is unverified. */
export const EMAIL_NOT_VERIFIED_CODE = "email_not_verified";

/**
 * A failed API call. `message` is a sentence that can be shown to the user as-is.
 * `code` is the API's machine-readable error code when it sends one (otherwise ""); see
 * `isEmailNotVerified` for the sign-in case.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: FieldErrors;
  readonly code: string;

  constructor(status: number, message: string, fieldErrors: FieldErrors = {}, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

/** True for the sign-in error that means "enter the code we emailed you" (status 400, code email_not_verified). */
export function isEmailNotVerified(error: unknown): boolean {
  return error instanceof ApiError && error.code === EMAIL_NOT_VERIFIED_CODE;
}

/** The `code` of the 409 when someone else saved the week's plan after this client read it. */
export const PLAN_CHANGED_CODE = "plan_changed";
/** The `code` of the 409 when a first plan was sent but the week already has a plan. */
export const PLAN_EXISTS_CODE = "plan_exists";

/** 409 plan_changed: the plan was updated elsewhere (another tab); refetch it and review the new split. */
export class PlanChangedError extends ApiError {
  constructor(source: ApiError) {
    super(source.status, source.message, source.fieldErrors, PLAN_CHANGED_CODE);
    this.name = "PlanChangedError";
  }
}

/** 409 plan_exists: the week already has a plan; open it and update it instead. */
export class PlanExistsError extends ApiError {
  constructor(source: ApiError) {
    super(source.status, source.message, source.fieldErrors, PLAN_EXISTS_CODE);
    this.name = "PlanExistsError";
  }
}

/** Turn the plan endpoints' 409s into their typed errors; any other error passes through. */
function planConflict(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409) {
    if (error.code === PLAN_CHANGED_CODE) return new PlanChangedError(error);
    if (error.code === PLAN_EXISTS_CODE) return new PlanExistsError(error);
  }
  return error;
}

function fieldLabel(field: string): string {
  return field
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// DRF nests messages for list and dict fields, e.g. {"courses": [{"name": ["..."]}]}.
function collectMessages(value: unknown): string[] {
  if (typeof value === "string") {
    return value ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectMessages);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectMessages);
  }
  return [];
}

function retryAfterSeconds(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

// Cross-origin responses hide Retry-After from scripts unless the API exposes it via
// Access-Control-Expose-Headers, so fall back to DRF's "Expected available in N seconds."
function throttleDetailSeconds(payload: unknown): number | null {
  const detail = (payload as { detail?: unknown } | null)?.detail;
  const match = typeof detail === "string" ? /available in (\d+) seconds?/i.exec(detail) : null;
  return match ? Number(match[1]) : null;
}

/** Turn a non-2xx response body into an ApiError with a readable message. */
export function toApiError(status: number, payload: unknown, retryAfter: string | null = null): ApiError {
  if (status === 429) {
    const seconds = retryAfterSeconds(retryAfter) ?? throttleDetailSeconds(payload);
    const wait = seconds === null ? "a moment" : `${seconds} second${seconds === 1 ? "" : "s"}`;
    return new ApiError(status, `Too many attempts. Please wait ${wait} and try again.`);
  }
  if (status >= 500) {
    return new ApiError(status, SERVER_ERROR_MESSAGE);
  }

  const messages: string[] = [];
  const fieldErrors: FieldErrors = {};
  let code = "";
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    messages.push(...collectMessages(body.detail), ...collectMessages(body.non_field_errors));
    if (typeof body.code === "string") {
      code = body.code;
    }
    for (const [field, value] of Object.entries(body)) {
      if (field === "detail" || field === "non_field_errors" || (field === "code" && typeof value === "string")) {
        continue;
      }
      const fieldMessages = collectMessages(value);
      if (fieldMessages.length > 0) {
        fieldErrors[field] = fieldMessages;
        messages.push(`${fieldLabel(field)}: ${fieldMessages[0]}`);
      }
    }
  } else {
    // Plain-text bodies are shown; HTML error pages are not.
    messages.push(...collectMessages(payload).filter((text) => !text.trimStart().startsWith("<")));
  }

  const message = messages.join(" ") || `The request couldn't be completed (error ${status}).`;
  return new ApiError(status, message, fieldErrors, code);
}

async function parseResponse(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

async function send(path: string, method: RequestMethod, body: unknown, token: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    return await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE);
  }
}

// -- session expiry ------------------------------------------------------------

type SessionExpiredHandler = () => void;

function redirectToSignIn(): void {
  if (typeof window === "undefined") {
    return;
  }
  const next = `${window.location.pathname}${window.location.search}`;
  // A full page load on purpose: it drops all in-memory state of the expired session, and this
  // module runs outside React, where useRouter() isn't available.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/sign-in?next=${encodeURIComponent(next)}&reason=expired`);
}

let onSessionExpired: SessionExpiredHandler = redirectToSignIn;

/** Replace the expiry redirect (used by tests). Returns a function that restores the previous one. */
export function setSessionExpiredHandler(handler: SessionExpiredHandler): () => void {
  const previous = onSessionExpired;
  onSessionExpired = handler;
  return () => {
    onSessionExpired = previous;
  };
}

function expireSession(): ApiError {
  // Concurrent requests can all end up here; only the first one redirects.
  if (hasSession()) {
    clearSession();
    onSessionExpired();
  }
  return new ApiError(401, SESSION_EXPIRED_MESSAGE);
}

// -- refresh (single-flight) ------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchange the refresh token for a new access token. Every caller that arrives while a
 * refresh is running shares it. Resolves false when the refresh token is missing or
 * rejected (the session is over); throws ApiError for transient failures (network,
 * throttling, 5xx) so the session survives them.
 */
function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const refresh = getRefreshToken();
  if (!refresh) {
    return Promise.resolve(false);
  }
  refreshInFlight = (async () => {
    try {
      const response = await send(REFRESH_PATH, "POST", { refresh }, "");
      const payload = await parseResponse(response);
      if (response.status === 400 || response.status === 401) {
        return false;
      }
      if (!response.ok) {
        throw toApiError(response.status, payload, response.headers.get("Retry-After"));
      }
      const access = (payload as { access?: unknown }).access;
      if (typeof access !== "string" || !access) {
        return false;
      }
      setAccessToken(access);
      return true;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// -- requests --------------------------------------------------------------------

type RequestOptions = {
  /** false for login and register: no bearer token, and a 401 is never refreshed. */
  auth?: boolean;
};

async function request<T>(
  path: string,
  method: RequestMethod,
  body?: unknown,
  { auth = true }: RequestOptions = {},
): Promise<T> {
  // SimpleJWT rejects a stale bearer token even on open endpoints, so auth calls send none.
  const sentToken = auth ? getAccessToken() : "";
  let response = await send(path, method, body, sentToken);

  if (response.status === 401 && auth) {
    // Another request may have refreshed the token while this one was in flight.
    const current = getAccessToken();
    const canRetry = Boolean(current && current !== sentToken) || (await refreshAccessToken());
    if (!canRetry) {
      throw expireSession();
    }
    response = await send(path, method, body, getAccessToken());
    if (response.status === 401) {
      throw expireSession();
    }
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    throw toApiError(response.status, payload, response.headers.get("Retry-After"));
  }
  return payload as T;
}

export type RegisterPayload = { username: string; email: string; password: string };

/** Registering creates an unverified account and emails a 6-digit code; no tokens are issued yet. */
export type RegisterVerificationResponse = { status: "verification_required"; email: string };

/** `identifier` is a username or an email address; the server also still accepts it as `username`. */
export type LoginPayload = { identifier: string; password: string };
export type LoginResponse = { access: string; refresh: string };

/** One course's hours in a plan's `allocations`, the shape plans had before revisions. */
export type PlanAllocation = {
  course: string;
  allocated_hours: number;
  focus_block_minutes: number;
  break_minutes: number;
  base_hours?: number;
  adherence_factor?: number;
  /** Where the adherence adjustment came from; absent on plans from before adjustments. */
  adjustment_source?: "model" | "rule" | "none";
  /** The adherence the plan expected for this course, or null when there was nothing to estimate from. */
  adherence_estimate?: number | null;
};

export type AdjustmentSource = "model" | "rule" | "none";

/** One course in a version-2 plan revision. planned_hours = logged_at_revision + remaining_at_revision. */
export type PlanCourseEntry = {
  /** Null only for a first-version plan converted on the server; absent for names no course has yet. */
  course_id: number | null;
  name: string;
  difficulty: number;
  factor: number;
  adjustment_source: AdjustmentSource;
  adherence_estimate: number | null;
  /** YYYY-MM-DD the course entered the plan; pacing runs from here. */
  entered_on: string;
  logged_at_revision: number;
  remaining_at_revision: number;
  planned_hours: number;
  focus_block_minutes: number;
  break_minutes: number;
};

/** A course taken out of the week's plan; its logs stay in history but no longer count. */
export type RemovedPlanCourse = {
  course_id: number | null;
  name: string;
  /** YYYY-MM-DD. */
  removed_on: string;
  logged_hours: number;
};

export type PlanMode = "first" | "update" | "course_deleted";

/** Version-2 plan_json: the revision's courses, plus the first-version fields older readers use. */
export type WeeklyPlanJson = {
  version: 2;
  mode: PlanMode;
  /** YYYY-MM-DD the revision was made (server date). */
  made_on: string;
  total_hours: number;
  more_hours: number;
  counted_hours: number;
  /** True when the requested total was below the hours already counted and was raised to match. */
  clamped: boolean;
  courses: PlanCourseEntry[];
  removed: RemovedPlanCourse[];
  total_available_hours: number;
  allocations: PlanAllocation[];
};

/**
 * A plan's stored shape. Plans saved before revisions (version 1) carry only
 * `allocations`, with `courses` as {name, difficulty}; version-2 plans (`WeeklyPlanJson`) carry both
 * and every field is then present. Read it through lib/week.ts rather than directly.
 */
export type PlanHistoryItem = {
  id: number;
  week_start: string;
  plan_json: {
    version?: number;
    mode?: PlanMode;
    made_on?: string;
    total_hours?: number;
    more_hours?: number;
    counted_hours?: number;
    clamped?: boolean;
    total_available_hours?: number;
    courses?: Array<Partial<PlanCourseEntry>>;
    removed?: Array<Partial<RemovedPlanCourse>>;
    allocations?: Array<{
      course?: string;
      allocated_hours?: number;
      focus_block_minutes?: number;
      break_minutes?: number;
    }>;
  };
  created_at: string;
};

/** One revision of a week's plan, as /planner/plans/ returns it. */
export type WeeklyPlan = {
  id: number;
  week_start: string;
  revision: number;
  /** How many revisions this week has in all (this one included). */
  revision_count: number;
  is_current: boolean;
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
  plan_json: WeeklyPlanJson;
};

/** A week's current plan with the days left in it; `revisions` (older ones) only when asked for. */
export type WeeklyPlanDetail = WeeklyPlan & { days_left: number; revisions?: WeeklyPlan[] };

export type PlanCourseInput = { name: string; difficulty: number };

/**
 * What to plan. A first plan (nothing saved for the week) gives the whole week's `total_hours` and
 * `base_revision: null`; an update gives `more_hours` (on top of what is already done) and the
 * `base_revision` it was opened at.
 */
export type WeeklyPlanInput =
  | { courses: PlanCourseInput[]; total_hours: number; base_revision: null }
  | { courses: PlanCourseInput[]; more_hours: number; base_revision: number };

/** The split a save would make; nothing is saved. */
export type PlanPreview = {
  week_start: string;
  base_revision: number | null;
  days_left: number;
  clamped: boolean;
  plan_json: WeeklyPlanJson;
};

export type SessionLogPayload = {
  course_name: string;
  planned_minutes: number;
  actual_minutes: number;
  focus_score: number;
  completion_rate: number;
};

export type SessionLogResponse = {
  message: string;
  computed: {
    adherence: number;
    predicted_adherence: number;
    model_version: string;
    focus_score: number;
    completion_rate: number;
  };
};

export type SessionHistoryItem = {
  id: number;
  course_name: string;
  planned_minutes: number;
  actual_minutes: number;
  focus_score: number;
  completion_rate: number;
  adherence_score: number;
  predicted_adherence: number | null;
  model_version: string;
  created_at: string;
};

export type SessionHistoryResponse = {
  items: SessionHistoryItem[];
};

export type TrainingDataItem = {
  user_id: number;
  course_name: string;
  difficulty: number;
  planned_minutes: number;
  actual_minutes: number;
  focus_score: number;
  completion_rate: number;
  adherence_score: number;
  sessions_last_7_days: number;
  created_at: string;
};

export type TrainingDataResponse = {
  rows: TrainingDataItem[];
  count: number;
};

export type ForecastStatus = "ok" | "insufficient_history" | "model_unavailable" | "prediction_failed";

export type ForecastFeatureName = "adh_lag1" | "adh_lag2" | "adh_mean3" | "adh_trend" | "weeks_history";

/** One course's next-week forecast. Any feature can be null when the history lacks it. */
export type ForecastItem = {
  course_name: string;
  status: ForecastStatus;
  predicted_adherence: number | null;
  model_version: string | null;
  weeks_history: number;
  features: Partial<Record<ForecastFeatureName, number | null>>;
};

export type LearningDemand = "problem_solving" | "conceptual" | "memorisation" | "writing" | "practical";

export type AssessmentFormat =
  | "timed_problem_exam"
  | "multiple_choice"
  | "essay_exam"
  | "coursework"
  | "continuous_quizzes";

/** One of the user's courses. `assessment_format` is "" and the other traits null or empty until answered. */
export type Course = {
  id: number;
  name: string;
  difficulty: number;
  learning_demands: LearningDemand[];
  builds_on_earlier: boolean | null;
  assessment_format: AssessmentFormat | "";
  exam_date: string | null;
  weekly_target_hours: number;
  created_at: string;
  updated_at: string;
};

/** Fields the user can set. On create only `name` is required. */
export type CourseInput = {
  name: string;
  difficulty?: number;
  learning_demands?: LearningDemand[];
  builds_on_earlier?: boolean | null;
  assessment_format?: AssessmentFormat | "";
  exam_date?: string | null;
};

export type StrategyKind = "technique" | "schedule" | "habit" | "focus" | "exam";
export type EvidenceBasis = "history" | "settings";
export type StrategyFeedbackValue = "helpful" | "not_helpful" | "tried";

export type StrategyFeedbackState = {
  rating: "helpful" | "not_helpful" | null;
  tried: boolean;
};

/** One structured recommendation. All display text is in title / what / how / why / source. */
export type CourseRecommendation = {
  shown_id: number;
  strategy_id: string;
  kind: StrategyKind;
  priority: number;
  basis: EvidenceBasis;
  title: string;
  what: string;
  how: string[];
  why: string;
  /** Diagnostic ids that chose this strategy; empty when it came from the course settings. */
  triggers: string[];
  /** The numbers behind `why` (e.g. n_long, median_gap_days, exam_in_days). */
  facts: Record<string, number | string | boolean | null>;
  source: { citation: string; short: string; note?: string };
  feedback: StrategyFeedbackState;
};

export type CourseEvidence = {
  basis: EvidenceBasis;
  /** e.g. "Based on 14 sessions over 4 weeks" or "Based on your course settings only". */
  summary: string;
  window_days: number;
  sessions: number;
  total_sessions: number;
  study_days: number;
  weeks: number;
  mean_adherence: number | null;
  mean_completion: number | null;
  mean_focus: number | null;
  forecast: { status: ForecastStatus; predicted_adherence: number | null; weeks_history: number };
  exam_in_days: number | null;
  plan: { allocated_hours: number; logged_hours: number } | null;
  diagnostics: string[];
};

export type CourseRecommendations = {
  course: {
    id: number;
    name: string;
    difficulty: number;
    learning_demands: LearningDemand[];
    builds_on_earlier: boolean | null;
    assessment_format: AssessmentFormat | null;
    exam_date: string | null;
  };
  evidence: CourseEvidence;
  recommendations: CourseRecommendation[];
};

export type CourseRecommendationsResponse = {
  generated_at: string;
  week_start: string;
  /** False when the server has AI plans turned off, so "Write my weekly plan" would only repeat the checklist. */
  ai_plan_available: boolean;
  courses: CourseRecommendations[];
};

export type StrategyFeedbackResponse = StrategyFeedbackState & { shown_id: number };

/** This week's plan for a course. "ai" only when the write-up passed validation; otherwise rules-only. */
export type CoursePlan = {
  source: "ai" | "rules";
  week_start: string;
  intro: string;
  items: Array<{ strategy_id: string; title: string; body: string }>;
  /** True when the daily AI budget was used up, so the rules-only plan was served. */
  throttled: boolean;
  /** The model id, present only when source is "ai". */
  model?: string;
};

/** Suggested traits for a course name, for the user to confirm. Nothing is saved. */
export type TraitSuggestion = {
  source: "ai" | "keywords";
  learning_demands: LearningDemand[];
  builds_on_earlier: boolean | null;
  assessment_format: AssessmentFormat | null;
  throttled: boolean;
};

export function loginUser(payload: LoginPayload): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/token/", "POST", payload, { auth: false });
}

export type Me = { id: number; username: string; email: string };

/** The signed-in user. */
export function getMe(): Promise<Me> {
  return request<Me>("/users/me/", "GET");
}

/** The current plan of each week, newest week first. */
export async function listPlans(limit?: number): Promise<WeeklyPlan[]> {
  const query = limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`;
  const response = await request<{ items: WeeklyPlan[] }>(`/planner/plans/${query}`, "GET");
  return response.items;
}

/**
 * A week's current plan (`weekStart` is that week's Monday, YYYY-MM-DD), or null when it has none.
 * `revisions: true` adds the superseded revisions.
 */
export async function getPlan(weekStart: string, options: { revisions?: boolean } = {}): Promise<WeeklyPlanDetail | null> {
  const query = options.revisions ? "?revisions=1" : "";
  try {
    return await request<WeeklyPlanDetail>(`/planner/plans/${encodeURIComponent(weekStart)}/${query}`, "GET");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** The split a save would make, with nothing saved. Throws PlanChangedError / PlanExistsError on a 409. */
export async function previewPlan(weekStart: string, input: WeeklyPlanInput): Promise<PlanPreview> {
  try {
    return await request<PlanPreview>("/planner/plans/preview/", "POST", { week_start: weekStart, ...input });
  } catch (error) {
    throw planConflict(error);
  }
}

/**
 * Save the week's first plan or its next revision. Throws PlanChangedError when `base_revision` is
 * no longer the current revision, and PlanExistsError when a first plan is sent for a week that has one.
 */
export async function savePlan(weekStart: string, input: WeeklyPlanInput): Promise<WeeklyPlanDetail> {
  try {
    return await request<WeeklyPlanDetail>(`/planner/plans/${encodeURIComponent(weekStart)}/`, "PUT", input);
  } catch (error) {
    throw planConflict(error);
  }
}

export function logSession(payload: SessionLogPayload): Promise<SessionLogResponse> {
  return request<SessionLogResponse>("/tracking/session-log/", "POST", payload);
}

export function getSessionHistory(): Promise<SessionHistoryResponse> {
  return request<SessionHistoryResponse>("/tracking/history/", "GET");
}

export function getTrainingData(): Promise<TrainingDataResponse> {
  return request<TrainingDataResponse>("/tracking/training-data/", "GET");
}

/** Forecast one course, or every course the user has logged when `courseName` is omitted. */
export function predictAdherence(courseName?: string): Promise<ForecastItem[]> {
  return request<ForecastItem[]>("/tracking/predict/", "POST", courseName ? { course_name: courseName } : {});
}

export function listCourses(): Promise<Course[]> {
  return request<Course[]>("/planner/courses/", "GET");
}

export function createCourse(payload: CourseInput): Promise<Course> {
  return request<Course>("/planner/courses/", "POST", payload);
}

/** Renaming also moves the course's session logs to the new name. */
export function updateCourse(id: number, payload: Partial<CourseInput>): Promise<Course> {
  return request<Course>(`/planner/courses/${id}/`, "PATCH", payload);
}

/** Deleting a course keeps its session logs and plan history. */
export async function deleteCourse(id: number): Promise<void> {
  await request<unknown>(`/planner/courses/${id}/`, "DELETE");
}

/** Structured recommendations for every course, or one. Each one shown is logged once per week. */
export function getCourseRecommendations(courseId?: number): Promise<CourseRecommendationsResponse> {
  const query = courseId === undefined ? "" : `?course_id=${encodeURIComponent(String(courseId))}`;
  return request<CourseRecommendationsResponse>(`/recommendations/courses/${query}`, "GET");
}

export function getCoursePlan(courseId: number): Promise<CoursePlan> {
  return request<CoursePlan>(`/recommendations/courses/${encodeURIComponent(String(courseId))}/plan/`, "GET");
}

export function suggestCourseTraits(name: string): Promise<TraitSuggestion> {
  return request<TraitSuggestion>("/planner/courses/suggest-traits/", "POST", { name });
}

/** "helpful" and "not_helpful" replace each other; "tried" is independent. */
export function sendStrategyFeedback(shownId: number, value: StrategyFeedbackValue): Promise<StrategyFeedbackResponse> {
  return request<StrategyFeedbackResponse>("/recommendations/feedback/", "POST", { shown_id: shownId, value });
}

/**
 * Register a new account. The server answers 201 with `verification_required`: the user must then
 * enter the emailed code (`verifyEmail`).
 */
export function startRegistration(payload: RegisterPayload): Promise<RegisterVerificationResponse> {
  return request<RegisterVerificationResponse>("/users/register/", "POST", payload, { auth: false });
}

/** Check the emailed code. On success the account is verified and the tokens sign the user straight in. */
export function verifyEmail(email: string, code: string): Promise<LoginResponse> {
  return request<LoginResponse>("/users/verify-email/", "POST", { email, code }, { auth: false });
}

export type MessageResponse = { detail: string };

/** Ask for a fresh verification code. The server always answers 200, whether or not the email has an account. */
export function resendCode(email: string): Promise<MessageResponse> {
  return request<MessageResponse>("/users/resend-code/", "POST", { email, purpose: "verify" }, { auth: false });
}

/** Ask for a password reset code. The server always answers 200, whether or not the email has an account. */
export function requestPasswordReset(email: string): Promise<MessageResponse> {
  return request<MessageResponse>("/users/password-reset/request/", "POST", { email }, { auth: false });
}

export type PasswordResetPayload = { email: string; code: string; new_password: string };

/** Set a new password with the emailed code. A weak password is a 400 with `fieldErrors.new_password`. */
export function confirmPasswordReset(payload: PasswordResetPayload): Promise<MessageResponse> {
  return request<MessageResponse>("/users/password-reset/confirm/", "POST", payload, { auth: false });
}
