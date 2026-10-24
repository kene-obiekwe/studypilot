import { clearSession, getAccessToken, getRefreshToken, hasSession, setAccessToken } from "./session";

// next.config.js refuses a production build without NEXT_PUBLIC_API_BASE_URL, so this
// fallback only ever applies to `next dev`.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api";

const REFRESH_PATH = "/auth/token/refresh/";

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";
export const SERVER_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";
export const SESSION_EXPIRED_MESSAGE = "Your session expired. Please sign in again.";

type RequestMethod = "GET" | "POST" | "PATCH" | "DELETE";
type FieldErrors = Record<string, string[]>;

/** A failed API call. `message` is a sentence that can be shown to the user as-is. */
export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: FieldErrors;

  constructor(status: number, message: string, fieldErrors: FieldErrors = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
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
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    messages.push(...collectMessages(body.detail), ...collectMessages(body.non_field_errors));
    for (const [field, value] of Object.entries(body)) {
      if (field === "detail" || field === "non_field_errors") {
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
  return new ApiError(status, message, fieldErrors);
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
  window.location.assign(`/auth?next=${encodeURIComponent(next)}&reason=expired`);
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
export type RegisterResponse = { id: number; username: string };

export type LoginPayload = { username: string; password: string };
export type LoginResponse = { access: string; refresh: string };

export type PlanPayload = {
  total_available_hours: number;
  courses: Array<{ name: string; difficulty: number }>;
};

export type PlanResponse = {
  allocations: Array<{
    course: string;
    allocated_hours: number;
    focus_block_minutes: number;
    break_minutes: number;
    base_hours?: number;
    adherence_factor?: number;
  }>;
};

export type PlanHistoryItem = {
  id: number;
  week_start: string;
  plan_json: {
    total_available_hours?: number;
    courses?: Array<{ name?: string; difficulty?: number }>;
    allocations?: Array<{
      course?: string;
      allocated_hours?: number;
      focus_block_minutes?: number;
      break_minutes?: number;
    }>;
  };
  created_at: string;
};

export type PlanHistoryResponse = {
  items: PlanHistoryItem[];
};

export type RecommendationPayload = {
  focus_score: number;
  completion_rate: number;
  preferred_style: "visual" | "reading" | "practice" | "mixed";
};

export type RecommendationResponse = {
  strategies: string[];
  confidence: number;
};

export type RecommendationHistoryItem = {
  id: number;
  focus_score: number;
  completion_rate: number;
  preferred_style: string;
  strategies_json: string[];
  confidence: number;
  created_at: string;
};

export type RecommendationHistoryResponse = {
  items: RecommendationHistoryItem[];
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
  courses: CourseRecommendations[];
};

export type StrategyFeedbackResponse = StrategyFeedbackState & { shown_id: number };

export function registerUser(payload: RegisterPayload): Promise<RegisterResponse> {
  return request<RegisterResponse>("/users/register/", "POST", payload, { auth: false });
}

export function loginUser(payload: LoginPayload): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/token/", "POST", payload, { auth: false });
}

export function generatePlan(payload: PlanPayload): Promise<PlanResponse> {
  return request<PlanResponse>("/planner/generate/", "POST", payload);
}

export function getPlanHistory(): Promise<PlanHistoryResponse> {
  return request<PlanHistoryResponse>("/planner/history/", "GET");
}

export function generateRecommendations(payload: RecommendationPayload): Promise<RecommendationResponse> {
  return request<RecommendationResponse>("/recommendations/generate/", "POST", payload);
}

export function getRecommendationHistory(): Promise<RecommendationHistoryResponse> {
  return request<RecommendationHistoryResponse>("/recommendations/history/", "GET");
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

/** "helpful" and "not_helpful" replace each other; "tried" is independent. */
export function sendStrategyFeedback(shownId: number, value: StrategyFeedbackValue): Promise<StrategyFeedbackResponse> {
  return request<StrategyFeedbackResponse>("/recommendations/feedback/", "POST", { shown_id: shownId, value });
}
