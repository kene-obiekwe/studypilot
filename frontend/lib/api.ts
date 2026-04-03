const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api";

type RequestMethod = "GET" | "POST";

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

async function request<T>(path: string, method: RequestMethod, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await parseResponse(response);
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(message || "Request failed");
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
};

export type RecommendationHistoryItem = {
  id: number;
  focus_score: number;
  completion_rate: number;
  preferred_style: string;
  strategies_json: string[];
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

export function registerUser(payload: RegisterPayload): Promise<RegisterResponse> {
  return request<RegisterResponse>("/users/register/", "POST", payload);
}

export function loginUser(payload: LoginPayload): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/token/", "POST", payload);
}

export function generatePlan(payload: PlanPayload, token: string): Promise<PlanResponse> {
  return request<PlanResponse>("/planner/generate/", "POST", payload, token);
}

export function getPlanHistory(token: string): Promise<PlanHistoryResponse> {
  return request<PlanHistoryResponse>("/planner/history/", "GET", undefined, token);
}

export function generateRecommendations(
  payload: RecommendationPayload,
  token: string
): Promise<RecommendationResponse> {
  return request<RecommendationResponse>("/recommendations/generate/", "POST", payload, token);
}

export function getRecommendationHistory(token: string): Promise<RecommendationHistoryResponse> {
  return request<RecommendationHistoryResponse>("/recommendations/history/", "GET", undefined, token);
}

export function logSession(payload: SessionLogPayload, token: string): Promise<SessionLogResponse> {
  return request<SessionLogResponse>("/tracking/session-log/", "POST", payload, token);
}

export function getSessionHistory(token: string): Promise<SessionHistoryResponse> {
  return request<SessionHistoryResponse>("/tracking/history/", "GET", undefined, token);
}

export function getTrainingData(token: string): Promise<TrainingDataResponse> {
  return request<TrainingDataResponse>("/tracking/training-data/", "GET", undefined, token);
}
