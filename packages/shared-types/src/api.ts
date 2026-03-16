// Auth — Ailancers Platform API
export interface LoginRequest {
  email: string;
  password: string;
}

/** Ailancers platform user object returned from login/verify */
export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  is_active: boolean;
  is_email_verified: boolean;
  bio: string | null;
  location: string | null;
  country: string | null;
  mobile: string | null;
}

/** Response from POST /api/v1/auth/login */
export interface LoginResponse {
  token: string;
  user: PlatformUser;
  message: string;
  signup_bonus_credited: boolean;
}

/** Response from GET /api/v1/auth/verify (also refreshes the token) */
export interface VerifyResponse {
  token: string;
  user: PlatformUser;
  message: string;
  signup_bonus_credited: boolean;
}

// Chat
export interface CreateConversationRequest {
  projectId?: string;
  title?: string;
}

export interface SendMessageRequest {
  content: string;
  model?: string;
}

// Telemetry
export interface TelemetryBatchRequest {
  events: Array<{
    eventType: string;
    eventData: Record<string, unknown>;
    timestamp: string;
  }>;
}

export interface TelemetryBatchResponse {
  accepted: number;
}

// Generic
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
