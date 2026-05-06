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
  | { type: "sendAgentMessage"; conversationId: string; content: string; model?: string; agentType?: "coder" | "qa" | "design" | "supervisor"; images?: ImageAttachment[]; planMode?: boolean; excludeEditorContext?: boolean; effort?: "low" | "medium" | "high" }
  | { type: "cancelStream"; conversationId: string }
  | { type: "loadConversations" }
  | { type: "loadModels" }
  | { type: "newConversation" }
  | { type: "loadMessages"; conversationId: string }
  | { type: "exportConversation"; conversationId: string; format: "markdown" | "json" }
  | { type: "toolApprovalResponse"; toolCallId: string; decision: "allow" | "allowAll" | "deny"; editedInput?: Record<string, unknown> }
  | { type: "openSettings" }
  | { type: "openDocs" }
  | { type: "sendFeedback" }
  | { type: "openFile"; path: string; line?: number; endLine?: number }
  | { type: "loadConfig" }
  | { type: "writeAllowRule"; rule: string }
  | { type: "initProjectRules" }
  | { type: "openPermissionsFile" }
  | { type: "loadFileList"; query: string }
  | { type: "showProposedDiff"; path: string; oldText?: string; newText?: string; content?: string }
  | { type: "loadChecklist" }
  | { type: "saveChecklist"; completed: string[]; dismissed: boolean }
  | { type: "openMarkdownInEditor"; content: string; suggestedName?: string }
  | { type: "loadFilePreview"; path: string }
  | { type: "openAuditLog" }
  | { type: "pickMemoryFile" }
  | { type: "setPermissionMode"; mode: "default" | "plan" | "accept-edits" | "bypass" }
  | { type: "saveMemorySuggestion"; suggestion: string }
  | { type: "loadCustomCommands" }
  | { type: "openCustomCommandsFolder" }
  | { type: "openEditableProposed"; toolCallId: string }
  | { type: "compactConversation"; conversationId: string }
  | { type: "renameConversation"; conversationId: string; title: string };

/** Webview-relevant chunk of `ailancers.*` settings, pushed by the host. */
export interface WebviewConfig {
  useCtrlEnterToSend: boolean;
  initialPermissionMode: "default" | "plan";
  hideOnboarding: boolean;
  /** Optional default model id sourced from `.ailancers/settings.json`. When
   *  set, seeds the picker's default for new conversations until the user
   *  explicitly overrides it via the dropdown. */
  defaultModelFromSettings?: string;
}

/** Messages FROM the extension host TO the webview */
export type IncomingMessage =
  | { type: "authState"; authenticated: boolean }
  | { type: "loginResult"; success: boolean; error?: string }
  | { type: "conversationCreated"; data: Conversation }
  | { type: "conversations"; data: Conversation[] }
  | { type: "stream_start"; conversationId: string; messageId: string }
  | { type: "stream_delta"; conversationId: string; delta: string }
  | { type: "stream_thinking"; conversationId: string; delta: string }
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
  | { type: "modelsLoaded"; models: AvailableModel[]; defaults?: { chatModel: string; codingModel: string } }
  // Host-initiated UI nudges
  | { type: "focusInput" }
  | { type: "insertAtCursor"; text: string }
  | { type: "requestCancel" }
  | { type: "configLoaded"; config: WebviewConfig }
  | { type: "editorContextSnapshot"; snapshot: EditorContextSnapshot | null }
  | { type: "fileListResult"; query: string; matches: FileMatch[] }
  | { type: "checklistLoaded"; completed: string[]; dismissed: boolean }
  | { type: "filePreview"; path: string; content: string | null }
  | { type: "customCommandsLoaded"; commands: CustomSlashCommand[] }
  /** Sent when the user closes the editable proposed-content doc.
   *  `editedContent` is the final saved/closed text — the webview merges
   *  it into the approval response. */
  | { type: "editableProposedClosed"; toolCallId: string; editedContent: string }
  | { type: "compactResult"; conversationId: string; compacted: boolean; summarised?: number; reason?: string }
  | { type: "conversationRenamed"; conversationId: string; title: string }
  | { type: "conversation_titled"; conversationId: string; title: string };

/** A user-authored slash command loaded from `.ailancers/commands/*.md`.
 *  The body is a prompt template; `$ARGUMENTS` is replaced with whatever
 *  the user typed after the command name. */
export interface CustomSlashCommand {
  /** What the user types after `/` (filename without extension). */
  name: string;
  /** Short description from frontmatter `description:` field, if present. */
  description?: string;
  /** Argument hint from frontmatter `argHint:` field, if present. */
  argHint?: string;
  /** Markdown body — the prompt template. May contain `$ARGUMENTS`. */
  body: string;
}

/** Tiny shape used by the input footer indicator — *not* the full editorContext
 *  we send to the model. Just enough to render `📎 src/foo.ts (3 lines)`. */
export interface EditorContextSnapshot {
  /** Workspace-relative path or absolute fallback */
  activeFile: string;
  /** 1-based selection range, if non-empty */
  selectionLines?: number;
}

/** A single file-list match returned from the host for `@` autocomplete. */
export interface FileMatch {
  /** Workspace-relative path with forward slashes. */
  path: string;
  /** Filename only (last segment) — used for primary-line display. */
  name: string;
}

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
