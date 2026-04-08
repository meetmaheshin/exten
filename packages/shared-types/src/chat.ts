// Agent protocol types are re-exported from ./agent
import type { WsAgentMessage, WsToolResult, WsToolApproval, WsToolCall, WsToolResultAck, WsAgentTurnStart, WsAgentComplete, WsBudgetWarning, WsBillingSuspended, ImageAttachment } from "./agent.js";

export interface Conversation {
  id: string;
  userId: string;
  projectId: string | null;
  title: string | null;
  model: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  model: string | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

// WebSocket protocol types
export interface WsSendMessage {
  type: "message";
  conversationId: string;
  content: string;
  model?: string;
  images?: ImageAttachment[];
  subProjectId?: string | null;
}

export interface WsCancelMessage {
  type: "cancel";
  conversationId: string;
}

export type WsClientMessage =
  | WsSendMessage
  | WsCancelMessage
  | WsAgentMessage
  | WsToolResult
  | WsToolApproval;

export interface WsStreamStart {
  type: "stream_start";
  conversationId: string;
  messageId: string;
}

export interface WsStreamDelta {
  type: "stream_delta";
  conversationId: string;
  delta: string;
}

export interface WsStreamEnd {
  type: "stream_end";
  conversationId: string;
  messageId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

export interface WsError {
  type: "error";
  conversationId: string;
  error: string;
}

export interface WsRateLimited {
  type: "rate_limited";
  retryAfterMs: number;
}

export type WsServerMessage =
  | WsStreamStart
  | WsStreamDelta
  | WsStreamEnd
  | WsError
  | WsRateLimited
  | WsToolCall
  | WsToolResultAck
  | WsAgentTurnStart
  | WsAgentComplete
  | WsBudgetWarning
  | WsBillingSuspended;
