/** Messages FROM the webview TO the extension host */
export type OutgoingMessage =
  | { type: "getAuthState" }
  | { type: "login" }
  | { type: "sendMessage"; conversationId: string; content: string; model?: string }
  | { type: "sendAgentMessage"; conversationId: string; content: string; model?: string }
  | { type: "cancelStream"; conversationId: string }
  | { type: "loadConversations" }
  | { type: "loadModels" }
  | { type: "newConversation" }
  | { type: "loadMessages"; conversationId: string };

/** Messages FROM the extension host TO the webview */
export type IncomingMessage =
  | { type: "authState"; authenticated: boolean }
  | { type: "conversationCreated"; data: Conversation }
  | { type: "conversations"; data: Conversation[] }
  | { type: "stream_start"; conversationId: string; messageId: string }
  | { type: "stream_delta"; conversationId: string; delta: string }
  | { type: "stream_end"; conversationId: string; messageId: string; usage: TokenUsage }
  | { type: "error"; conversationId: string; error: string }
  | { type: "rate_limited"; retryAfterMs: number }
  | { type: "messagesLoaded"; data: { conversation: Conversation; messages: ChatMessage[] } }
  // Agent mode messages
  | { type: "tool_call"; conversationId: string; toolCallId: string; toolName: string; toolInput: Record<string, unknown>; requiresApproval: boolean }
  | { type: "tool_result_ack"; conversationId: string; toolCallId: string }
  | { type: "agent_turn_start"; conversationId: string; turnNumber: number }
  | { type: "agent_complete"; conversationId: string; totalUsage: AgentUsage }
  | { type: "budget_warning"; conversationId: string; currentCostUsd: number; budgetUsd: number; percentUsed: number }
  | { type: "modelsLoaded"; models: AvailableModel[] };

export interface Conversation {
  id: string;
  title: string | null;
  model: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  createdAt?: string;
  toolCalls?: ToolCallDisplay[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turnCount: number;
  toolCallCount: number;
}

export type AIProvider = "anthropic" | "openai";

export interface AvailableModel {
  id: string;
  name: string;
  provider: AIProvider;
}

export interface ToolCallDisplay {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "error" | "denied";
  result?: string;
  isError?: boolean;
}
