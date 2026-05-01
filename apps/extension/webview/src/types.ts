export interface ImageAttachment {
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

/** Messages FROM the webview TO the extension host */
export type OutgoingMessage =
  | { type: "getAuthState" }
  | { type: "login"; email: string; password: string }
  | { type: "loginWithBrowser" }
  | { type: "sendMessage"; conversationId: string; content: string; model?: string; images?: ImageAttachment[] }
  | { type: "sendAgentMessage"; conversationId: string; content: string; model?: string; agentType?: "coder" | "qa" | "design" | "supervisor"; images?: ImageAttachment[]; planMode?: boolean }
  | { type: "cancelStream"; conversationId: string }
  | { type: "loadConversations" }
  | { type: "loadModels" }
  | { type: "newConversation" }
  | { type: "loadMessages"; conversationId: string }
  | { type: "exportConversation"; conversationId: string; format: "markdown" | "json" }
  | { type: "toolApprovalResponse"; toolCallId: string; decision: "allow" | "allowAll" | "deny" };

/** Messages FROM the extension host TO the webview */
export type IncomingMessage =
  | { type: "authState"; authenticated: boolean }
  | { type: "loginResult"; success: boolean; error?: string }
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
  | { type: "tool_approval_request"; conversationId: string; toolCallId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: "tool_result_ack"; conversationId: string; toolCallId: string; result?: string; isError?: boolean }
  | { type: "agent_turn_start"; conversationId: string; turnNumber: number }
  | { type: "agent_complete"; conversationId: string; totalUsage: AgentUsage }
  | { type: "budget_warning"; conversationId: string; currentCostUsd: number; budgetUsd: number; percentUsed: number }
  | { type: "billing_suspended"; conversationId: string; reason: "SUSPENDED" | "CAP_REACHED"; message: string }
  | { type: "modelsLoaded"; models: AvailableModel[]; defaults?: { chatModel: string; codingModel: string } };

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
  images?: ImageAttachment[];
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
  category?: "code" | "chat" | "reasoning";
}

export interface ToolCallDisplay {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "error" | "denied";
  result?: string;
  isError?: boolean;
}

export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  conversationId: string;
}
