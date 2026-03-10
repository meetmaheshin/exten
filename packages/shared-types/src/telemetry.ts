export type TelemetryEventType =
  | "heartbeat"
  | "file_change"
  | "file_save"
  | "idle_start"
  | "idle_end"
  | "session_start"
  | "session_end"
  | "chat_request"
  | "chat_response"
  | "error";

export interface TelemetryEvent {
  eventType: TelemetryEventType;
  eventData: Record<string, unknown>;
  timestamp: string;
}

export interface SessionStartRequest {
  projectSlug: string;
  editorVersion: string;
  extensionVersion: string;
  os: string;
}

export interface SessionHeartbeat {
  sessionId: string;
  activeSeconds: number;
  idleSeconds: number;
  keystrokeCount: number;
  fileSaveCount: number;
  fileChangeCount: number;
  filesModified: Record<string, { language: string; changes: number }>;
  languageSeconds: Record<string, number>;
  isCurrentlyIdle: boolean;
}

export interface ActivitySnapshot {
  activeSeconds: number;
  idleSeconds: number;
  keystrokeCount: number;
  fileSaveCount: number;
  fileChangeCount: number;
  filesModified: Record<string, { language: string; changes: number }>;
  languageSeconds: Record<string, number>;
  isCurrentlyIdle: boolean;
}

export interface ActivitySession {
  id: string;
  userId: string;
  projectId: string | null;
  startedAt: string;
  endedAt: string | null;
  activeSeconds: number;
  idleSeconds: number;
  totalKeystrokes: number;
  totalFileSaves: number;
  totalFileChanges: number;
  filesTouched: Array<{ path: string; language: string; changeCount: number }>;
  languagesUsed: Record<string, number>;
  editorVersion: string | null;
  extensionVersion: string | null;
  osPlatform: string | null;
}

export interface ScreenshotRecord {
  id: string;
  userId: string;
  sessionId: string | null;
  projectId: string | null;
  filename: string;
  fileSizeBytes: number;
  metadata: Record<string, unknown>;
  capturedAt: string;
}

export interface ScreenshotUploadRequest {
  sessionId: string;
  filename: string;
  imageBase64: string;
  capturedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ActivitySummary {
  totalSessions: number;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalKeystrokes: number;
  totalFileSaves: number;
  totalFileChanges: number;
}

export interface DailyActivityBreakdown {
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  keystrokes: number;
  fileSaves: number;
  sessions: number;
}

export interface TeamActivityOverview {
  userId: string;
  email: string;
  fullName: string;
  team: string | null;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalKeystrokes: number;
  totalFileSaves: number;
  sessionCount: number;
  lastActive: string;
}
