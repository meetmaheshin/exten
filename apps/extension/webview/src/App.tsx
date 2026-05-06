import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getVsCodeApi } from "./vscodeApi";
import { useVsCodeMessages } from "./hooks/useVsCodeMessages";
import { LoginScreen } from "./components/LoginScreen";
import { ChatToolbar } from "./components/ChatToolbar";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import { ConversationList } from "./components/ConversationList";
import { AgentStatusBar } from "./components/AgentStatusBar";
import { OnboardingChecklist, type ChecklistItemId, type ChecklistState } from "./components/OnboardingChecklist";
import type { ChatMessage, Conversation, IncomingMessage, TokenUsage, AgentUsage, ToolCallDisplay, AvailableModel, PendingApproval, ImageAttachment, WebviewConfig, EditorContextSnapshot, FileMatch, CustomSlashCommand } from "./types";
import { parseSlashCommand, resolveCommand, SLASH_COMMANDS } from "./components/SlashCommands";

// ─── State ───────────────────────────────────────────────────────

/**
 * StreamItem: a single item in the chronological stream.
 * The AI response is rendered as a list of these in order.
 */
export type StreamItem =
  | { kind: "text"; content: string }
  | { kind: "tool"; data: ToolCallDisplay }
  | { kind: "approval"; data: PendingApproval };

interface AppState {
  authenticated: boolean;
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: ChatMessage[];
  // Streaming
  isStreaming: boolean;
  /** True between user clicking Stop and backend confirming the stream ended.
   *  Used to swap the Stop button label to "Cancelling…" so users know their
   *  click registered even if the backend takes a beat to flush. */
  isCancelling: boolean;
  stream: StreamItem[];           // chronological: text + tools + approvals
  streamingContent: string;       // full accumulated text (for saving)
  /** Extended-thinking output for the current turn. Cleared on stream end.
   *  Rendered above the answer in a collapsible "Reasoning" block when
   *  non-empty. Doesn't leak into `streamingContent` because the saved
   *  message only stores the visible answer. */
  streamingThinking: string;
  // Pending send
  pendingMessage: string | null;
  pendingImages: ImageAttachment[] | null;
  showConversations: boolean;
  // Agent
  agentMode: boolean;
  agentType: "coder" | "qa" | "design" | "supervisor";
  planMode: boolean;
  agentTurnNumber: number;
  // Input history for ↑/↓ recall — most recent first, capped at 50
  inputHistory: string[];
  // External "load this into the textarea" trigger (used by edit & resend)
  inputPrefill: { content: string; nonce: number } | null;
  agentToolCalls: ToolCallDisplay[];
  agentUsage: AgentUsage | null;
  pendingApprovals: PendingApproval[];
  // Models
  availableModels: AvailableModel[];
  selectedModel: string;
  defaultChatModel: string;
  defaultCodingModel: string;
  // Live config pushed from the host (useCtrlEnterToSend, initialPermissionMode, hideOnboarding)
  config: WebviewConfig;
  // Active editor snapshot for the input footer indicator
  editorSnapshot: EditorContextSnapshot | null;
  /** When true, the agent will NOT auto-receive the active editor's path /
   *  selection on the next send. Toggled via the 📎 indicator click. */
  excludeEditorContext: boolean;
  /** Onboarding checklist state — backed by the host's `globalState`. */
  checklist: ChecklistState;
  /** Reasoning-effort selector. `null` = use model default (no thinking block
   *  sent to the API). Mapped on the backend to Anthropic `thinking.budget_tokens`
   *  for Claude or `reasoning_effort` for OpenAI. */
  effort: "low" | "medium" | "high" | null;
  /** Unified permission mode — one of:
   *   • "default"      — prompt for risky tools (current behaviour)
   *   • "plan"         — replaces the legacy `planMode` flag
   *   • "accept-edits" — auto-allows edit/write/read for the session,
   *                      still prompts for `run_terminal` and other risky tools
   *   • "bypass"       — auto-allows EVERY tool. Shown with a danger banner.
   *  When non-default the legacy `planMode` flag is derived (`plan` ⇒ true,
   *  others ⇒ false) so the existing wire shape stays unchanged. */
  permissionMode: "default" | "plan" | "accept-edits" | "bypass";
  /** User-authored slash commands loaded from `.ailancers/commands/*.md`.
   *  Pushed by the host on auth-state load and on file change. Merged into
   *  the picker alongside the built-in registry. */
  customSlashCommands: CustomSlashCommand[];
}

type Action =
  | { type: "SET_AUTH"; authenticated: boolean }
  | { type: "SET_CONVERSATIONS"; data: Conversation[] }
  | { type: "CONVERSATION_CREATED"; data: Conversation }
  | { type: "SELECT_CONVERSATION"; id: string }
  | { type: "MESSAGES_LOADED"; messages: ChatMessage[] }
  | { type: "ADD_USER_MESSAGE"; content: string; images?: ImageAttachment[] }
  | { type: "STREAM_START" }
  | { type: "STREAM_DELTA"; delta: string }
  | { type: "STREAM_THINKING"; delta: string }
  | { type: "STREAM_END"; usage: TokenUsage }
  | { type: "STREAM_ERROR"; error: string }
  | { type: "BEGIN_CANCEL" }
  | { type: "INJECT_LOCAL_ASSISTANT"; content: string }
  | { type: "SET_PENDING"; content: string; images?: ImageAttachment[] | null }
  | { type: "TOGGLE_CONVERSATIONS" }
  | { type: "TOGGLE_AGENT_MODE" }
  | { type: "TOGGLE_PLAN_MODE" }
  | { type: "RECORD_HISTORY"; content: string }
  | { type: "PREFILL_INPUT"; content: string }
  | { type: "SET_AGENT_TYPE"; agentType: "coder" | "qa" | "design" | "supervisor" }
  | { type: "SET_MODELS"; models: AvailableModel[]; defaults?: { chatModel: string; codingModel: string } }
  | { type: "SET_SELECTED_MODEL"; model: string }
  | { type: "SET_CONFIG"; config: WebviewConfig }
  | { type: "SET_EDITOR_SNAPSHOT"; snapshot: EditorContextSnapshot | null }
  | { type: "TOGGLE_EXCLUDE_EDITOR_CONTEXT" }
  | { type: "SET_CHECKLIST"; checklist: ChecklistState }
  | { type: "MARK_CHECKLIST_ITEM"; itemId: ChecklistItemId }
  | { type: "DISMISS_CHECKLIST" }
  | { type: "SET_EFFORT"; effort: "low" | "medium" | "high" | null }
  | { type: "SET_PERMISSION_MODE"; mode: "default" | "plan" | "accept-edits" | "bypass" }
  | { type: "SET_CUSTOM_COMMANDS"; commands: CustomSlashCommand[] }
  | { type: "AGENT_TURN_START"; turnNumber: number }
  | { type: "TOOL_CALL_STARTED"; toolCallId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: "TOOL_CALL_COMPLETED"; toolCallId: string; result?: string; isError?: boolean }
  | { type: "AGENT_COMPLETE"; usage: AgentUsage }
  | { type: "ADD_PENDING_APPROVAL"; approval: PendingApproval }
  | { type: "REMOVE_PENDING_APPROVAL"; toolCallId: string };

const initialState: AppState = {
  authenticated: false,
  conversations: [],
  currentConversationId: null,
  messages: [],
  isStreaming: false,
  isCancelling: false,
  stream: [],
  streamingContent: "",
  streamingThinking: "",
  pendingMessage: null,
  pendingImages: null,
  showConversations: false,
  agentMode: true,
  agentType: "coder" as const,
  planMode: false,
  agentTurnNumber: 0,
  inputHistory: [],
  inputPrefill: null,
  agentToolCalls: [],
  agentUsage: null,
  pendingApprovals: [],
  availableModels: [],
  selectedModel: "",
  defaultChatModel: "",
  defaultCodingModel: "",
  config: {
    useCtrlEnterToSend: false,
    initialPermissionMode: "default",
    hideOnboarding: false,
  },
  editorSnapshot: null,
  excludeEditorContext: false,
  // "openChat" is auto-completed because the user is necessarily looking at
  // the chat to see this. The host pushes the persisted state on first load,
  // overriding this default.
  checklist: { completed: ["openChat"], dismissed: false },
  effort: null,
  permissionMode: "default",
  customSlashCommands: [],
};

// ─── Reducer ─────────────────────────────────────────────────────

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_AUTH":
      return { ...state, authenticated: action.authenticated };
    case "SET_CONVERSATIONS":
      return { ...state, conversations: action.data };
    case "CONVERSATION_CREATED":
      return { ...state, conversations: [action.data, ...state.conversations], currentConversationId: action.data.id, messages: [], showConversations: false, stream: [], agentToolCalls: [], agentTurnNumber: 0, agentUsage: null };
    case "SELECT_CONVERSATION":
      return { ...state, currentConversationId: action.id, messages: [], showConversations: false, stream: [], agentToolCalls: [], agentTurnNumber: 0, agentUsage: null };
    case "MESSAGES_LOADED":
      return { ...state, messages: action.messages };

    // ── Send message → start streaming ──
    case "ADD_USER_MESSAGE":
      return { ...state, messages: [...state.messages, { role: "user", content: action.content, images: action.images }], isStreaming: true, stream: [], streamingContent: "", streamingThinking: "", agentToolCalls: [], agentTurnNumber: 0, agentUsage: null, pendingApprovals: [] };
    case "STREAM_START":
      return { ...state, isStreaming: true, stream: [], streamingContent: "", streamingThinking: "" };
    case "STREAM_THINKING":
      return { ...state, streamingThinking: state.streamingThinking + action.delta };

    // ── Text delta → append to last text item or create new one ──
    case "STREAM_DELTA": {
      const delta = action.delta;
      const newContent = state.streamingContent + delta;
      const items = [...state.stream];
      const last = items[items.length - 1];
      if (last && last.kind === "text") {
        items[items.length - 1] = { kind: "text", content: last.content + delta };
      } else {
        items.push({ kind: "text", content: delta });
      }
      return { ...state, streamingContent: newContent, stream: items };
    }

    // ── Stream end → save message ──
    case "STREAM_END":
      return {
        ...state,
        messages: [...state.messages, {
          role: "assistant",
          content: state.streamingContent,
          inputTokens: action.usage.inputTokens,
          outputTokens: action.usage.outputTokens,
          costUsd: action.usage.costUsd,
          toolCalls: state.agentToolCalls.length > 0 ? [...state.agentToolCalls] : undefined,
        }],
        isStreaming: false,
        isCancelling: false,
        stream: [],
        streamingContent: "",
        streamingThinking: "",
      };

    case "STREAM_ERROR":
      return { ...state, messages: [...state.messages, { role: "assistant", content: `Error: ${action.error}`, toolCalls: state.agentToolCalls.length > 0 ? [...state.agentToolCalls] : undefined }], isStreaming: false, isCancelling: false, stream: [], streamingContent: "", streamingThinking: "", agentToolCalls: [], pendingApprovals: [], agentUsage: null };
    case "BEGIN_CANCEL":
      return { ...state, isCancelling: true };

    case "INJECT_LOCAL_ASSISTANT":
      // Slash-command output ("/help", "/cost") is rendered as an assistant
      // message but never round-tripped to the model. No tokens, no cost.
      return {
        ...state,
        messages: [...state.messages, { role: "assistant", content: action.content }],
      };

    case "SET_PENDING":
      return { ...state, pendingMessage: action.content, pendingImages: action.images ?? null };
    case "TOGGLE_CONVERSATIONS":
      return { ...state, showConversations: !state.showConversations };
    case "TOGGLE_AGENT_MODE": {
      const newMode = !state.agentMode;
      // Keep `planMode` independent of agent toggle — flipping agent off then on
      // shouldn't silently wipe a user's plan-mode choice. Plan only matters
      // while in agent mode but persists across the toggle.
      return { ...state, agentMode: newMode, agentType: "coder", selectedModel: newMode ? (state.defaultCodingModel || state.selectedModel) : (state.defaultChatModel || state.selectedModel) };
    }
    case "TOGGLE_PLAN_MODE":
      return { ...state, planMode: !state.planMode };
    case "RECORD_HISTORY": {
      const trimmed = action.content.trim();
      if (!trimmed) return state;
      // Dedupe consecutive identical entries
      if (state.inputHistory[0] === trimmed) return state;
      return { ...state, inputHistory: [trimmed, ...state.inputHistory].slice(0, 50) };
    }
    case "PREFILL_INPUT":
      return { ...state, inputPrefill: { content: action.content, nonce: Date.now() } };
    case "SET_AGENT_TYPE":
      return { ...state, agentType: action.agentType, agentMode: true };
    case "SET_MODELS": {
      // settings.json `model` (if any) overrides the backend's default for
      // BOTH chat and code defaults. This is the seed value — once the user
      // picks something via the dropdown, `state.selectedModel` wins.
      const fromSettings = state.config.defaultModelFromSettings;
      const cd = fromSettings || action.defaults?.chatModel || action.models[0]?.id || "";
      const cod = fromSettings || action.defaults?.codingModel || action.models[0]?.id || "";
      return { ...state, availableModels: action.models, selectedModel: state.selectedModel || (state.agentMode ? cod : cd), defaultChatModel: cd, defaultCodingModel: cod };
    }
    case "SET_SELECTED_MODEL":
      return { ...state, selectedModel: action.model };
    case "SET_EDITOR_SNAPSHOT":
      return { ...state, editorSnapshot: action.snapshot };
    case "TOGGLE_EXCLUDE_EDITOR_CONTEXT":
      return { ...state, excludeEditorContext: !state.excludeEditorContext };
    case "SET_CHECKLIST":
      return { ...state, checklist: action.checklist };
    case "MARK_CHECKLIST_ITEM": {
      if (state.checklist.completed.includes(action.itemId)) return state;
      return {
        ...state,
        checklist: {
          ...state.checklist,
          completed: [...state.checklist.completed, action.itemId],
        },
      };
    }
    case "DISMISS_CHECKLIST":
      return { ...state, checklist: { ...state.checklist, dismissed: true } };
    case "SET_EFFORT":
      return { ...state, effort: action.effort };
    case "SET_CUSTOM_COMMANDS":
      return { ...state, customSlashCommands: action.commands };
    case "SET_PERMISSION_MODE":
      // Derive legacy `planMode` so the existing send wire (and backend
      // `WsAgentMessage.planMode`) keeps working without a schema change.
      return {
        ...state,
        permissionMode: action.mode,
        planMode: action.mode === "plan",
        // If the user picks plan from chat-only, also turn agent mode on
        // (plan only makes sense in agent mode).
        agentMode: action.mode === "plan" ? true : state.agentMode,
      };
    case "SET_CONFIG": {
      // Only adopt `initialPermissionMode` on first config-push (i.e. when
      // we haven't created a conversation yet). After that, the user's
      // toggle wins — we don't want a workspace-settings change to silently
      // flip plan mode mid-conversation.
      const adoptInitialMode = !state.currentConversationId && state.messages.length === 0;
      return {
        ...state,
        config: action.config,
        ...(adoptInitialMode
          ? { planMode: action.config.initialPermissionMode === "plan" }
          : {}),
      };
    }

    // ── Agent tool events → add to stream chronologically ──
    case "AGENT_TURN_START":
      return { ...state, agentTurnNumber: action.turnNumber };

    case "TOOL_CALL_STARTED": {
      const tc: ToolCallDisplay = { toolCallId: action.toolCallId, toolName: action.toolName, toolInput: action.toolInput, status: "running" };
      return {
        ...state,
        agentToolCalls: [...state.agentToolCalls, tc],
        stream: [...state.stream, { kind: "tool", data: tc }],
      };
    }

    case "TOOL_CALL_COMPLETED": {
      const updated = state.agentToolCalls.map((tc) =>
        tc.toolCallId === action.toolCallId ? { ...tc, status: action.isError ? "error" as const : "completed" as const, result: action.result, isError: action.isError } : tc
      );
      // Update in stream too
      const items = state.stream.map((item) =>
        item.kind === "tool" && item.data.toolCallId === action.toolCallId
          ? { ...item, data: { ...item.data, status: action.isError ? "error" as const : "completed" as const, result: action.result, isError: action.isError } }
          : item
      );
      return { ...state, agentToolCalls: updated, stream: items };
    }

    case "AGENT_COMPLETE":
      return { ...state, agentUsage: action.usage, isStreaming: false, isCancelling: false, pendingApprovals: [] };

    case "ADD_PENDING_APPROVAL":
      return {
        ...state,
        pendingApprovals: [...state.pendingApprovals, action.approval],
        stream: [...state.stream, { kind: "approval", data: action.approval }],
      };

    case "REMOVE_PENDING_APPROVAL":
      return { ...state, pendingApprovals: state.pendingApprovals.filter((a) => a.toolCallId !== action.toolCallId) };

    default:
      return state;
  }
}

// ─── App ─────────────────────────────────────────────────────────

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const vscode = useRef(getVsCodeApi());
  // `@`-file autocomplete state. Lives outside the reducer because it's purely
  // a request/response cache for the picker — no other slice of state cares
  // about it, and the messages are not part of the chat transcript.
  const [atFileMatches, setAtFileMatches] = useState<FileMatch[]>([]);
  const [atQuery, setAtQuery] = useState<string>("");
  // Per-toolCallId edited content captured by the "Edit & approve" workflow.
  // Stored in a ref so the handleApproval closure picks up fresh values
  // without triggering a re-render storm.
  const editedProposedRef = useRef<Map<string, string>>(new Map());
  // Keeps the latest query accessible to the message handler without forcing
  // it into the dependency list (a stale callback would drop fresh results).
  const atQueryRef = useRef<string>("");
  useEffect(() => { atQueryRef.current = atQuery; }, [atQuery]);

  // Debounce file-list fetches: 80ms after the query settles. This is short
  // enough to feel instant on a fast filesystem, long enough to avoid spamming
  // the host while the user is typing rapidly. Empty query clears the matches
  // and skips the host call entirely.
  useEffect(() => {
    if (!atQuery && atQuery !== "") {
      // (defensive — atQuery is always a string)
      return;
    }
    if (atQuery === "") {
      // Clear matches when the trigger goes inactive. Don't fetch.
      setAtFileMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      vscode.current.postMessage({ type: "loadFileList", query: atQuery });
    }, 80);
    return () => clearTimeout(handle);
  }, [atQuery]);

  useEffect(() => { vscode.current.postMessage({ type: "getAuthState" }); }, []);
  useEffect(() => { if (state.authenticated) { vscode.current.postMessage({ type: "loadConversations" }); vscode.current.postMessage({ type: "loadModels" }); vscode.current.postMessage({ type: "loadChecklist" }); } }, [state.authenticated]);
  useEffect(() => { if (state.currentConversationId && state.authenticated) { vscode.current.postMessage({ type: "loadMessages", conversationId: state.currentConversationId }); } }, [state.currentConversationId, state.authenticated]);

  // Global "expand/collapse all tool calls" keyboard shortcuts.
  // Mirrors VS Code's fold / unfold style:
  //   • Ctrl/Cmd+Alt+]  → expand all tool blocks
  //   • Ctrl/Cmd+Alt+[  → collapse all tool blocks
  // Listened-for by every mounted ToolCallDisplay via window CustomEvents.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.altKey) return;
      if (e.key === "]") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("ailancers:expand-all-tools"));
      } else if (e.key === "[") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("ailancers:collapse-all-tools"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Honour host UI nudges (focusInput, insertAtCursor, requestCancel) by
  // re-emitting them as window CustomEvents the right child listens for. Keeps
  // App / ChatInput coupling minimal.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "focusInput") {
        window.dispatchEvent(new CustomEvent("ailancers:focus-input"));
      } else if (data.type === "insertAtCursor" && typeof data.text === "string") {
        window.dispatchEvent(new CustomEvent("ailancers:insert-at-cursor", { detail: { text: data.text } }));
      } else if (data.type === "requestCancel") {
        if (state.isStreaming && state.currentConversationId) {
          vscode.current.postMessage({ type: "cancelStream", conversationId: state.currentConversationId });
          dispatch({ type: "STREAM_ERROR", error: "Cancelled." });
        }
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [state.isStreaming, state.currentConversationId]);

  // Sync permissionMode to host every time it changes — the host pre-populates
  // its session-auto-approved tool set for accept-edits/bypass modes so the
  // user doesn't get prompted for every edit / file write.
  useEffect(() => {
    vscode.current.postMessage({ type: "setPermissionMode", mode: state.permissionMode });
  }, [state.permissionMode]);

  // Persist the onboarding checklist whenever it changes. Skips the very
  // first render (initial state hasn't been hydrated from the host yet) so
  // we don't clobber stored progress with the default.
  const checklistHydratedRef = useRef(false);
  useEffect(() => {
    if (!checklistHydratedRef.current) {
      // First non-default state we see is from the host's `checklistLoaded`.
      // Skip the first persist round so we don't overwrite it with the
      // initial { completed: ["openChat"], dismissed: false } default.
      checklistHydratedRef.current = true;
      return;
    }
    vscode.current.postMessage({
      type: "saveChecklist",
      completed: state.checklist.completed,
      dismissed: state.checklist.dismissed,
    });
  }, [state.checklist]);

  // Watchdog: reset if stuck >3min with no activity
  const lastActivityRef = useRef(Date.now());
  useEffect(() => { if (state.isStreaming) lastActivityRef.current = Date.now(); }, [state.isStreaming, state.stream.length]);
  useEffect(() => {
    if (!state.isStreaming) return;
    const wd = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 3 * 60 * 1000) {
        dispatch({ type: "STREAM_ERROR", error: "Agent timed out (no activity for 3 minutes)." });
      }
    }, 30_000);
    return () => clearInterval(wd);
  }, [state.isStreaming]);

  // Auto-send pending message after conversation created
  useEffect(() => {
    if (state.pendingMessage && state.currentConversationId) {
      const content = state.pendingMessage;
      const images = state.pendingImages ?? undefined;
      dispatch({ type: "ADD_USER_MESSAGE", content, images });
      dispatch({ type: "SET_PENDING", content: "" });
      vscode.current.postMessage({
        type: state.agentMode ? "sendAgentMessage" : "sendMessage",
        conversationId: state.currentConversationId,
        content,
        model: state.selectedModel || undefined,
        ...(state.agentMode ? { agentType: state.agentType, planMode: state.planMode, excludeEditorContext: state.excludeEditorContext, ...(state.effort ? { effort: state.effort } : {}) } : {}),
        ...(images ? { images } : {}),
      });
    }
  }, [state.pendingMessage, state.currentConversationId, state.agentMode, state.agentType, state.planMode, state.selectedModel, state.pendingImages, state.effort]);

  // ── Message handler ──
  const handleMessage = useCallback((msg: IncomingMessage) => {
    switch (msg.type) {
      case "authState": dispatch({ type: "SET_AUTH", authenticated: msg.authenticated }); break;
      case "conversations": dispatch({ type: "SET_CONVERSATIONS", data: msg.data }); break;
      case "conversationCreated": dispatch({ type: "CONVERSATION_CREATED", data: msg.data }); break;
      case "stream_start": dispatch({ type: "STREAM_START" }); break;
      case "stream_delta": dispatch({ type: "STREAM_DELTA", delta: msg.delta }); break;
      case "stream_thinking": dispatch({ type: "STREAM_THINKING", delta: msg.delta }); break;
      case "stream_end": dispatch({ type: "STREAM_END", usage: msg.usage }); break;
      case "error": dispatch({ type: "STREAM_ERROR", error: msg.error }); break;
      case "messagesLoaded": if (msg.data?.messages) dispatch({ type: "MESSAGES_LOADED", messages: msg.data.messages }); break;
      case "agent_turn_start": dispatch({ type: "AGENT_TURN_START", turnNumber: msg.turnNumber }); break;
      case "tool_call": dispatch({ type: "TOOL_CALL_STARTED", toolCallId: msg.toolCallId, toolName: msg.toolName, toolInput: msg.toolInput }); break;
      case "tool_approval_request": dispatch({ type: "ADD_PENDING_APPROVAL", approval: { toolCallId: msg.toolCallId, toolName: msg.toolName, toolInput: msg.toolInput, conversationId: msg.conversationId } }); break;
      case "tool_result_ack": dispatch({ type: "TOOL_CALL_COMPLETED", toolCallId: msg.toolCallId, result: msg.result, isError: msg.isError }); break;
      case "agent_complete":
        dispatch({ type: "AGENT_COMPLETE", usage: msg.totalUsage });
        // Backend may have just auto-titled this conversation. Refresh the
        // sidebar so the user sees the new title without a manual reload.
        // Cheap — single HTTP GET, only fires when an agent turn finishes.
        vscode.current.postMessage({ type: "loadConversations" });
        break;
      case "billing_suspended": dispatch({ type: "STREAM_ERROR", error: `__BILLING__${msg.reason}__${msg.message}` }); break;
      case "modelsLoaded": dispatch({ type: "SET_MODELS", models: msg.models, defaults: msg.defaults }); break;
      case "configLoaded": dispatch({ type: "SET_CONFIG", config: msg.config }); break;
      case "editorContextSnapshot": dispatch({ type: "SET_EDITOR_SNAPSHOT", snapshot: msg.snapshot }); break;
      case "fileListResult": {
        // Ignore stale results: the user has typed past this query already.
        // Compare against the ref so the closure stays stable but we still see
        // the live value.
        if (msg.query !== atQueryRef.current) break;
        setAtFileMatches(msg.matches);
        break;
      }
      case "customCommandsLoaded": {
        dispatch({ type: "SET_CUSTOM_COMMANDS", commands: msg.commands });
        break;
      }
      case "editableProposedClosed": {
        // Stash the edited content for this toolCallId. handleApproval reads
        // it on the next allow/allowAll click and sends it as `editedInput`.
        editedProposedRef.current.set(msg.toolCallId, msg.editedContent);
        break;
      }
      case "conversationRenamed": {
        // Reload the sidebar so the new title shows. Cheaper than threading
        // the (stale) `state.conversations` through this empty-deps closure.
        vscode.current.postMessage({ type: "loadConversations" });
        break;
      }
      case "compactResult": {
        if (msg.compacted) {
          dispatch({
            type: "INJECT_LOCAL_ASSISTANT",
            content: `✓ Compacted ${msg.summarised ?? 0} earlier message${msg.summarised === 1 ? "" : "s"} into a summary. The next agent turn will use the compacted context. Older messages are still in the database — \`/export\` sees them.`,
          });
        } else {
          dispatch({
            type: "INJECT_LOCAL_ASSISTANT",
            content: msg.reason ?? "Nothing to compact yet.",
          });
        }
        // Reload the message list so the system summary row is reflected.
        if (msg.conversationId) {
          vscode.current.postMessage({ type: "loadMessages", conversationId: msg.conversationId });
        }
        break;
      }
      case "checklistLoaded": {
        // Host pushes the persisted onboarding state on first auth-state load.
        // We always mark `openChat` because the user is necessarily seeing
        // this — saves an extra round-trip dispatch.
        const completed = Array.from(new Set([
          "openChat" as ChecklistItemId,
          ...((msg.completed ?? []) as ChecklistItemId[]),
        ]));
        dispatch({ type: "SET_CHECKLIST", checklist: { completed, dismissed: !!msg.dismissed } });
        break;
      }
    }
  }, []);

  useVsCodeMessages(handleMessage);

  if (!state.authenticated) return <LoginScreen />;

  // ── Handlers ──
  const handleSend = (content: string, images?: ImageAttachment[]) => {
    dispatch({ type: "RECORD_HISTORY", content });

    // Slash commands intercept the send: the user's message goes to the
    // local dispatcher instead of round-tripping to the model. Most commands
    // are pure UI nudges (set state) or reuse existing host commands; they
    // never spend tokens.
    const slash = parseSlashCommand(content);
    if (slash) {
      dispatch({ type: "MARK_CHECKLIST_ITEM", itemId: "trySlash" });
      handleSlashCommand(slash.name, slash.args, content);
      return;
    }

    // `@<agent-name>` at the very start of a message switches the agent type
    // for THIS turn. Strip the prefix from the content the user actually
    // sends, and dispatch `SET_AGENT_TYPE` so the rest of the conversation
    // continues with the new type. Lighter than `/agent` because the user
    // doesn't have to switch and re-type — one shot.
    let outboundContent = content;
    let outboundAgentType = state.agentType;
    const agentMention = /^@(coder|qa|design|supervisor)\s+/i.exec(content);
    if (agentMention) {
      const t = agentMention[1].toLowerCase() as "coder" | "qa" | "design" | "supervisor";
      outboundAgentType = t;
      outboundContent = content.slice(agentMention[0].length);
      if (t !== state.agentType) {
        dispatch({ type: "SET_AGENT_TYPE", agentType: t });
      }
      if (t !== "coder") {
        dispatch({ type: "MARK_CHECKLIST_ITEM", itemId: "tryAgentType" });
      }
    }

    // Mark `firstMessage` and `tryAt` for the onboarding checklist. `@token`
    // is detected loosely — any `@<non-space>` substring counts as a mention
    // attempt, which matches the picker's own trigger heuristic.
    dispatch({ type: "MARK_CHECKLIST_ITEM", itemId: "firstMessage" });
    if (/(^|\s)@\S/.test(content)) {
      dispatch({ type: "MARK_CHECKLIST_ITEM", itemId: "tryAt" });
    }

    if (!state.currentConversationId) {
      dispatch({ type: "SET_PENDING", content: outboundContent, images });
      vscode.current.postMessage({ type: "newConversation" });
      return;
    }
    dispatch({ type: "ADD_USER_MESSAGE", content: outboundContent, images });
    vscode.current.postMessage({
      type: state.agentMode ? "sendAgentMessage" : "sendMessage",
      conversationId: state.currentConversationId,
      content: outboundContent,
      model: state.selectedModel || undefined,
      ...(state.agentMode ? { agentType: outboundAgentType, planMode: state.planMode, excludeEditorContext: state.excludeEditorContext, ...(state.effort ? { effort: state.effort } : {}) } : {}),
      ...(images ? { images } : {}),
    });
  };

  /**
   * Slash-command dispatcher. Phase 1: every command reuses behaviour we
   * already have (newConversation / exportConversation / model state /
   * agent type / plan toggle). Output, where any, is rendered as a local
   * assistant message — no model round-trip, no tokens.
   */
  const handleSlashCommand = (name: string, args: string, raw: string) => {
    const cmd = resolveCommand(name);
    if (!cmd) {
      // Fall back to custom user-authored commands loaded from
      // `.ailancers/commands/*.md`. The body is a prompt template; we
      // substitute `$ARGUMENTS` with whatever the user typed after the
      // command name, then send the result as a regular agent message.
      const custom = state.customSlashCommands.find((c) => c.name.toLowerCase() === name);
      if (custom) {
        const expanded = custom.body.includes("$ARGUMENTS")
          ? custom.body.replace(/\$ARGUMENTS/g, args)
          : args
            ? `${custom.body}\n\n${args}`
            : custom.body;
        // Echo the slash invocation in the transcript so context is clear.
        dispatch({ type: "ADD_USER_MESSAGE", content: raw });
        dispatch({ type: "STREAM_END", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });
        if (!state.currentConversationId) {
          dispatch({ type: "SET_PENDING", content: expanded });
          vscode.current.postMessage({ type: "newConversation" });
          return;
        }
        dispatch({ type: "ADD_USER_MESSAGE", content: expanded });
        vscode.current.postMessage({
          type: state.agentMode ? "sendAgentMessage" : "sendMessage",
          conversationId: state.currentConversationId,
          content: expanded,
          model: state.selectedModel || undefined,
          ...(state.agentMode ? { agentType: state.agentType, planMode: state.planMode, excludeEditorContext: state.excludeEditorContext, ...(state.effort ? { effort: state.effort } : {}) } : {}),
        });
        return;
      }
      dispatch({
        type: "INJECT_LOCAL_ASSISTANT",
        content: `Unknown command: \`${raw}\`. Type \`/help\` for a list of available commands.`,
      });
      return;
    }
    // Echo the user's command back into the transcript so the dispatcher
    // output has something to attach to.
    dispatch({ type: "ADD_USER_MESSAGE", content: raw });
    // ADD_USER_MESSAGE flips `isStreaming = true`, which a slash command
    // doesn't actually want. Cancel that flag immediately by piping a
    // STREAM_END with zero usage.
    dispatch({ type: "STREAM_END", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });

    switch (cmd.name) {
      case "clear":
        vscode.current.postMessage({ type: "newConversation" });
        return;

      case "init":
        // Host scans the repo for package.json / pyproject.toml / etc., builds
        // a draft prompt, and inserts it into the textarea. The user reviews
        // and presses Enter — no silent calls, no surprises.
        vscode.current.postMessage({ type: "initProjectRules" });
        dispatch({
          type: "INJECT_LOCAL_ASSISTANT",
          content: "Reading your project metadata… you'll see a draft prompt in the input. Review it, then press Enter to send.",
        });
        return;

      case "hooks":
        // Hooks live in the same `.ailancers/settings.json` file that
        // permissions live in (single-file foundation). Open it.
        vscode.current.postMessage({ type: "openPermissionsFile" });
        return;

      case "permissions": {
        // `/permissions log` → open .ailancers/audit.log (decision history).
        // `/permissions` (no args) → open the settings file (same as /hooks).
        if (args.trim().toLowerCase() === "log") {
          vscode.current.postMessage({ type: "openAuditLog" });
        } else {
          vscode.current.postMessage({ type: "openPermissionsFile" });
        }
        return;
      }

      case "memory":
        // Host renders a quick-pick listing all rules / instructions files
        // (user → project team → project local). The user picks one and the
        // host opens it (creating the local override if it doesn't exist yet).
        vscode.current.postMessage({ type: "pickMemoryFile" });
        return;

      case "commands":
        // Host opens `.ailancers/commands/`, seeds a starter command if the
        // folder is empty, and reveals the directory in the explorer.
        vscode.current.postMessage({ type: "openCustomCommandsFolder" });
        return;

      case "copy": {
        const lastAssistant = [...state.messages].reverse().find((m) => m.role === "assistant");
        if (!lastAssistant) {
          dispatch({ type: "INJECT_LOCAL_ASSISTANT", content: "Nothing to copy yet." });
          return;
        }
        try {
          void navigator.clipboard.writeText(lastAssistant.content);
          dispatch({ type: "INJECT_LOCAL_ASSISTANT", content: "Copied last response to clipboard." });
        } catch {
          dispatch({ type: "INJECT_LOCAL_ASSISTANT", content: "Failed to copy — clipboard access denied." });
        }
        return;
      }

      case "export": {
        if (!state.currentConversationId) {
          dispatch({ type: "INJECT_LOCAL_ASSISTANT", content: "Nothing to export — no conversation yet." });
          return;
        }
        const fmt = args === "json" ? "json" : "markdown";
        vscode.current.postMessage({
          type: "exportConversation",
          conversationId: state.currentConversationId,
          format: fmt,
        });
        return;
      }

      case "compact": {
        if (!state.currentConversationId) {
          dispatch({ type: "INJECT_LOCAL_ASSISTANT", content: "No conversation to compact yet." });
          return;
        }
        dispatch({
          type: "INJECT_LOCAL_ASSISTANT",
          content: "Summarising the older turns of this conversation… this takes a few seconds.",
        });
        vscode.current.postMessage({
          type: "compactConversation",
          conversationId: state.currentConversationId,
        });
        return;
      }

      case "context": {
        // Surface what's loaded into context for the next turn. Helps the
        // user understand why their input-token cost is what it is.
        const userMsgs = state.messages.filter((m) => m.role === "user").length;
        const assistantMsgs = state.messages.filter((m) => m.role === "assistant").length;
        const lastInput = [...state.messages].reverse().find((m) => m.inputTokens != null)?.inputTokens ?? null;
        const totalIn = state.messages.reduce((s, m) => s + (m.inputTokens ?? 0), 0);
        const editorLine = state.editorSnapshot
          ? `- Editor context: \`${state.editorSnapshot.activeFile}\`${state.editorSnapshot.selectionLines ? ` (${state.editorSnapshot.selectionLines} lines selected)` : ""}${state.excludeEditorContext ? " — *currently excluded*" : ""}`
          : "- Editor context: *(no active file)*";
        dispatch({
          type: "INJECT_LOCAL_ASSISTANT",
          content:
            `**What's in context for the next turn**\n\n` +
            `- Conversation: ${userMsgs} user / ${assistantMsgs} assistant messages\n` +
            `- Agent: **${state.agentType}**${state.planMode ? " (plan mode)" : ""}, model \`${state.selectedModel || "default"}\`\n` +
            `${editorLine}\n` +
            `- Last turn input tokens: ${lastInput != null ? lastInput.toLocaleString() : "—"}\n` +
            `- Total input tokens this session: ${totalIn.toLocaleString()}\n` +
            `\n` +
            `Project rules (from \`.ailancers/instructions.md\`) and any \`instructions.local.md\` are appended to every turn's system prompt — they don't show in this list but they cost tokens. Run \`Ailancers: Open Project Rules\` to inspect.\n`,
        });
        return;
      }

      case "cost": {
        // Re-emit the agent completion banner shape — but as a local message,
        // since we already capture per-message tokens.
        const turnsSoFar = state.messages.filter((m) => m.role === "assistant").length;
        const totalCost = state.messages.reduce((s, m) => s + (m.costUsd ?? 0), 0);
        const totalIn = state.messages.reduce((s, m) => s + (m.inputTokens ?? 0), 0);
        const totalOut = state.messages.reduce((s, m) => s + (m.outputTokens ?? 0), 0);
        dispatch({
          type: "INJECT_LOCAL_ASSISTANT",
          content:
            `**Session usage so far**\n\n` +
            `- Assistant turns: ${turnsSoFar}\n` +
            `- Input tokens: ${totalIn.toLocaleString()}\n` +
            `- Output tokens: ${totalOut.toLocaleString()}\n` +
            `- Total cost: $${totalCost.toFixed(4)}\n`,
        });
        return;
      }

      case "agent": {
        const t = args.trim().toLowerCase();
        if (t === "coder" || t === "qa" || t === "design" || t === "supervisor") {
          if (t !== "coder") {
            dispatch({ type: "MARK_CHECKLIST_ITEM", itemId: "tryAgentType" });
          }
          dispatch({ type: "SET_AGENT_TYPE", agentType: t as "coder" | "qa" | "design" | "supervisor" });
          dispatch({ type: "INJECT_LOCAL_ASSISTANT", content: `Agent type set to **${t}**.` });
        } else {
          dispatch({
            type: "INJECT_LOCAL_ASSISTANT",
            content: "Usage: `/agent <coder|qa|design>`",
          });
        }
        return;
      }

      case "plan": {
        const t = args.trim().toLowerCase();
        const target = t === "on" ? true : t === "off" ? false : !state.planMode;
        dispatch({ type: "MARK_CHECKLIST_ITEM", itemId: "tryPlan" });
        if (target !== state.planMode) dispatch({ type: "TOGGLE_PLAN_MODE" });
        if (target && !state.agentMode) dispatch({ type: "TOGGLE_AGENT_MODE" });
        dispatch({
          type: "INJECT_LOCAL_ASSISTANT",
          content: `Plan mode is now **${target ? "ON" : "OFF"}**.`,
        });
        return;
      }

      case "model": {
        const id = args.trim();
        if (!id) {
          dispatch({
            type: "INJECT_LOCAL_ASSISTANT",
            content:
              `**Available models**:\n\n` +
              state.availableModels.map((m) => `- \`${m.id}\` — ${m.name}`).join("\n") +
              `\n\nCurrent: \`${state.selectedModel}\``,
          });
          return;
        }
        const match = state.availableModels.find((m) => m.id === id);
        if (!match) {
          dispatch({
            type: "INJECT_LOCAL_ASSISTANT",
            content: `Unknown model id: \`${id}\`. Use \`/model\` (no args) to list available models.`,
          });
          return;
        }
        dispatch({ type: "SET_SELECTED_MODEL", model: id });
        dispatch({ type: "INJECT_LOCAL_ASSISTANT", content: `Model set to **${match.name}**.` });
        return;
      }

      case "help":
      default: {
        const lines = [
          "**Available slash commands**:",
          "",
          ...SLASH_COMMANDS.map((c) =>
            `- \`/${c.name}${c.argHint ? " " + c.argHint : ""}\` — ${c.description}`
          ),
          "",
          "Tip: type `/` to open the picker, ↑/↓ to choose, Enter or Tab to select.",
        ];
        dispatch({ type: "INJECT_LOCAL_ASSISTANT", content: lines.join("\n") });
        return;
      }
    }
  };

  /** Pull a previous user message back into the input for editing — re-sending it later. */
  const handleEditMessage = (content: string) => {
    dispatch({ type: "PREFILL_INPUT", content });
  };

  const handleCancel = () => {
    if (state.currentConversationId && state.isStreaming) {
      vscode.current.postMessage({ type: "cancelStream", conversationId: state.currentConversationId });
      // Show "Cancelling…" until the backend confirms via stream_end / error;
      // give it 5s before forcing the stream-error fallback.
      dispatch({ type: "BEGIN_CANCEL" });
      setTimeout(() => {
        // If we're still in cancelling state after 5s, force-end.
        // We can't read state directly from a closure; just dispatch and let
        // the reducer's STREAM_ERROR handler no-op if isStreaming is false.
        dispatch({ type: "STREAM_ERROR", error: "Cancelled." });
      }, 5000);
    }
  };

  const handleApproval = (
    toolCallId: string,
    decision: "allow" | "allowAll" | "deny",
    explicitEditedInput?: Record<string, unknown>,
  ) => {
    dispatch({ type: "REMOVE_PENDING_APPROVAL", toolCallId });
    // Pull any edited content captured by the "Edit & approve" workflow.
    // The host sent us the edited full-file text after the user closed the
    // editable doc; we map it back to the right toolInput key based on the
    // approval's tool name (handled via the approvals state).
    let editedInput = explicitEditedInput;
    if (!editedInput && (decision === "allow" || decision === "allowAll")) {
      const edited = editedProposedRef.current.get(toolCallId);
      if (edited != null) {
        const approval = state.pendingApprovals.find((a) => a.toolCallId === toolCallId);
        if (approval) {
          if (approval.toolName === "edit_file") {
            // The executor honours an `__overwrite__` field as a full-file
            // replacement that bypasses the find-text-must-match check.
            // Used only by this user-edit-and-approve path; the agent
            // itself never emits this field.
            editedInput = { __overwrite__: edited };
          } else if (approval.toolName === "write_file") {
            editedInput = { content: edited };
          }
        }
        editedProposedRef.current.delete(toolCallId);
      }
    }
    vscode.current.postMessage({
      type: "toolApprovalResponse",
      toolCallId,
      decision,
      ...(editedInput ? { editedInput } : {}),
    });
  };

  return (
    <div className="app">
      <ChatToolbar
        title={state.conversations.find((c) => c.id === state.currentConversationId)?.title ?? "New Chat"}
        onNewChat={() => vscode.current.postMessage({ type: "newConversation" })}
        onToggleConversations={() => dispatch({ type: "TOGGLE_CONVERSATIONS" })}
        onExport={state.currentConversationId ? (format) => {
          const id = state.currentConversationId;
          if (id) vscode.current.postMessage({ type: "exportConversation", conversationId: id, format });
        } : undefined}
        showingConversations={state.showConversations}
      />
      {state.showConversations ? (
        <ConversationList
          conversations={state.conversations}
          activeId={state.currentConversationId}
          onSelect={(id) => dispatch({ type: "SELECT_CONVERSATION", id })}
          onRename={(id, title) => vscode.current.postMessage({ type: "renameConversation", conversationId: id, title })}
        />
      ) : (
        <>
          <OnboardingChecklist
            state={state.checklist}
            hidden={state.config.hideOnboarding}
            onDismiss={() => dispatch({ type: "DISMISS_CHECKLIST" })}
          />
          <MessageList
            messages={state.messages}
            isStreaming={state.isStreaming}
            stream={state.stream}
            streamingThinking={state.streamingThinking}
            pendingApprovals={state.pendingApprovals}
            onApprovalDecision={handleApproval}
            agentUsage={state.agentUsage}
            onEditMessage={handleEditMessage}
            planMode={state.planMode}
            onApprovePlan={() => {
              // Turn off plan mode and dispatch the next turn directly.
              // We can't reuse handleSend here because closure-captured state
              // would still report planMode=true; bypass by hand-rolling the
              // ADD_USER_MESSAGE + postMessage with planMode hardcoded off.
              const content = "Execute the plan above.";
              dispatch({ type: "TOGGLE_PLAN_MODE" });
              if (!state.currentConversationId) {
                dispatch({ type: "SET_PENDING", content });
                vscode.current.postMessage({ type: "newConversation" });
                return;
              }
              dispatch({ type: "ADD_USER_MESSAGE", content });
              vscode.current.postMessage({
                type: "sendAgentMessage",
                conversationId: state.currentConversationId,
                content,
                model: state.selectedModel || undefined,
                agentType: state.agentType,
                planMode: false,
                excludeEditorContext: state.excludeEditorContext,
                ...(state.effort ? { effort: state.effort } : {}),
              });
            }}
          />
          <AgentStatusBar
            turnNumber={state.agentTurnNumber}
            toolCallCount={state.agentToolCalls.length}
            usage={state.agentUsage}
            isActive={state.isStreaming && state.agentMode && state.agentTurnNumber > 0}
            agentType={state.agentType}
            onCancel={handleCancel}
          />
          <ChatInput
            onSend={handleSend}
            isStreaming={state.isStreaming}
            isCancelling={state.isCancelling}
            agentMode={state.agentMode}
            agentType={state.agentType}
            planMode={state.planMode}
            onTogglePlanMode={() => {
              dispatch({ type: "MARK_CHECKLIST_ITEM", itemId: "tryPlan" });
              dispatch({ type: "TOGGLE_PLAN_MODE" });
            }}
            onToggleAgentMode={() => dispatch({ type: "TOGGLE_AGENT_MODE" })}
            onSetAgentType={(t) => {
              if (t !== "coder") {
                dispatch({ type: "MARK_CHECKLIST_ITEM", itemId: "tryAgentType" });
              }
              dispatch({ type: "SET_AGENT_TYPE", agentType: t });
            }}
            availableModels={state.availableModels}
            selectedModel={state.selectedModel}
            onModelChange={(m) => dispatch({ type: "SET_SELECTED_MODEL", model: m })}
            inputHistory={state.inputHistory}
            prefill={state.inputPrefill}
            onCancel={handleCancel}
            useCtrlEnterToSend={state.config.useCtrlEnterToSend}
            editorSnapshot={state.editorSnapshot}
            excludeEditorContext={state.excludeEditorContext}
            onToggleExcludeEditorContext={() => dispatch({ type: "TOGGLE_EXCLUDE_EDITOR_CONTEXT" })}
            atFileMatches={atFileMatches}
            onAtQueryChange={setAtQuery}
            effort={state.effort}
            onEffortChange={(e) => dispatch({ type: "SET_EFFORT", effort: e })}
            customSlashCommands={state.customSlashCommands}
            permissionMode={state.permissionMode}
            onPermissionModeChange={(m) => {
              if (m === "plan") {
                dispatch({ type: "MARK_CHECKLIST_ITEM", itemId: "tryPlan" });
              }
              dispatch({ type: "SET_PERMISSION_MODE", mode: m });
            }}
          />
        </>
      )}
    </div>
  );
}
