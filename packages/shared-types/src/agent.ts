// ═══════════════════════════════════════════════════
// Agent Tool Types — shared between backend & extension
// ═══════════════════════════════════════════════════

export type ToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "run_terminal"
  | "search_files"
  | "list_directory"
  | "glob_files";

export const DESTRUCTIVE_TOOLS: ReadonlySet<ToolName> = new Set([
  "write_file",
  "edit_file",
  "run_terminal",
]);

export const AUTO_APPROVED_COMMANDS = [
  "ls", "dir", "cat", "head", "tail", "wc",
  "pwd", "echo", "tree", "find", "which", "where",
  "git status", "git log", "git diff", "git branch",
  "node --version", "npm --version", "pnpm --version",
  "tsc --version", "python --version",
];

export interface ToolCallSummary {
  toolCallId: string;
  toolName: ToolName;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  durationMs?: number;
  approved?: boolean;
}

// ─── WebSocket Protocol: Client → Server ───

export type AgentType = "coder" | "qa" | "design" | "planning";

export interface ImageAttachment {
  /** base64-encoded image data */
  data: string;
  /** MIME type (e.g. "image/png", "image/jpeg") */
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

export interface WsAgentMessage {
  type: "agent_message";
  conversationId: string;
  content: string;
  model?: string;
  agentType?: AgentType;
  images?: ImageAttachment[];
}

export interface WsToolResult {
  type: "tool_result";
  conversationId: string;
  toolCallId: string;
  result: string;
  isError?: boolean;
}

export interface WsToolApproval {
  type: "tool_approval";
  conversationId: string;
  toolCallId: string;
  approved: boolean;
}

// ─── WebSocket Protocol: Server → Client ───

export interface WsToolCall {
  type: "tool_call";
  conversationId: string;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface WsToolResultAck {
  type: "tool_result_ack";
  conversationId: string;
  toolCallId: string;
}

export interface WsAgentTurnStart {
  type: "agent_turn_start";
  conversationId: string;
  turnNumber: number;
}

export interface WsAgentComplete {
  type: "agent_complete";
  conversationId: string;
  totalUsage: AgentUsage;
}

export interface WsBillingSuspended {
  type: "billing_suspended";
  conversationId: string;
  reason: "SUSPENDED" | "CAP_REACHED";
  message: string;
}

export interface WsBudgetWarning {
  type: "budget_warning";
  conversationId: string;
  currentCostUsd: number;
  budgetUsd: number;
  percentUsed: number;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turnCount: number;
  toolCallCount: number;
}

// ─── Model / Provider Selection ───

export type AIProvider = "anthropic" | "openai";

export interface AvailableModel {
  id: string;
  name: string;
  provider: AIProvider;
  category?: "code" | "chat" | "reasoning";
}
