import type { UserPublic } from "./user";

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: UserPublic;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
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
