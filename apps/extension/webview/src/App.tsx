import { useCallback, useEffect, useReducer, useRef } from "react";
import { getVsCodeApi } from "./vscodeApi";
import { useVsCodeMessages } from "./hooks/useVsCodeMessages";
import { LoginScreen } from "./components/LoginScreen";
import { ChatToolbar } from "./components/ChatToolbar";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import { ConversationList } from "./components/ConversationList";
import { AgentStatusBar } from "./components/AgentStatusBar";
import type { ChatMessage, Conversation, IncomingMessage, TokenUsage, AgentUsage, ToolCallDisplay, AvailableModel, PendingApproval, ImageAttachment } from "./types";

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
  stream: StreamItem[];           // chronological: text + tools + approvals
  streamingContent: string;       // full accumulated text (for saving)
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
  | { type: "STREAM_END"; usage: TokenUsage }
  | { type: "STREAM_ERROR"; error: string }
  | { type: "SET_PENDING"; content: string; images?: ImageAttachment[] | null }
  | { type: "TOGGLE_CONVERSATIONS" }
  | { type: "TOGGLE_AGENT_MODE" }
  | { type: "TOGGLE_PLAN_MODE" }
  | { type: "RECORD_HISTORY"; content: string }
  | { type: "PREFILL_INPUT"; content: string }
  | { type: "SET_AGENT_TYPE"; agentType: "coder" | "qa" | "design" | "supervisor" }
  | { type: "SET_MODELS"; models: AvailableModel[]; defaults?: { chatModel: string; codingModel: string } }
  | { type: "SET_SELECTED_MODEL"; model: string }
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
  stream: [],
  streamingContent: "",
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
      return { ...state, messages: [...state.messages, { role: "user", content: action.content, images: action.images }], isStreaming: true, stream: [], streamingContent: "", agentToolCalls: [], agentTurnNumber: 0, agentUsage: null, pendingApprovals: [] };
    case "STREAM_START":
      return { ...state, isStreaming: true, stream: [], streamingContent: "" };

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
        stream: [],
        streamingContent: "",
      };

    case "STREAM_ERROR":
      return { ...state, messages: [...state.messages, { role: "assistant", content: `Error: ${action.error}`, toolCalls: state.agentToolCalls.length > 0 ? [...state.agentToolCalls] : undefined }], isStreaming: false, stream: [], streamingContent: "", agentToolCalls: [], pendingApprovals: [], agentUsage: null };

    case "SET_PENDING":
      return { ...state, pendingMessage: action.content, pendingImages: action.images ?? null };
    case "TOGGLE_CONVERSATIONS":
      return { ...state, showConversations: !state.showConversations };
    case "TOGGLE_AGENT_MODE": {
      const newMode = !state.agentMode;
      return { ...state, agentMode: newMode, agentType: "coder", planMode: newMode ? state.planMode : false, selectedModel: newMode ? (state.defaultCodingModel || state.selectedModel) : (state.defaultChatModel || state.selectedModel) };
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
      const cd = action.defaults?.chatModel || action.models[0]?.id || "";
      const cod = action.defaults?.codingModel || action.models[0]?.id || "";
      return { ...state, availableModels: action.models, selectedModel: state.selectedModel || (state.agentMode ? cod : cd), defaultChatModel: cd, defaultCodingModel: cod };
    }
    case "SET_SELECTED_MODEL":
      return { ...state, selectedModel: action.model };

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
      return { ...state, agentUsage: action.usage, isStreaming: false, pendingApprovals: [] };

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

  useEffect(() => { vscode.current.postMessage({ type: "getAuthState" }); }, []);
  useEffect(() => { if (state.authenticated) { vscode.current.postMessage({ type: "loadConversations" }); vscode.current.postMessage({ type: "loadModels" }); } }, [state.authenticated]);
  useEffect(() => { if (state.currentConversationId && state.authenticated) { vscode.current.postMessage({ type: "loadMessages", conversationId: state.currentConversationId }); } }, [state.currentConversationId, state.authenticated]);

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
        ...(state.agentMode ? { agentType: state.agentType, planMode: state.planMode } : {}),
        ...(images ? { images } : {}),
      });
    }
  }, [state.pendingMessage, state.currentConversationId, state.agentMode, state.agentType, state.planMode, state.selectedModel, state.pendingImages]);

  // ── Message handler ──
  const handleMessage = useCallback((msg: IncomingMessage) => {
    switch (msg.type) {
      case "authState": dispatch({ type: "SET_AUTH", authenticated: msg.authenticated }); break;
      case "conversations": dispatch({ type: "SET_CONVERSATIONS", data: msg.data }); break;
      case "conversationCreated": dispatch({ type: "CONVERSATION_CREATED", data: msg.data }); break;
      case "stream_start": dispatch({ type: "STREAM_START" }); break;
      case "stream_delta": dispatch({ type: "STREAM_DELTA", delta: msg.delta }); break;
      case "stream_end": dispatch({ type: "STREAM_END", usage: msg.usage }); break;
      case "error": dispatch({ type: "STREAM_ERROR", error: msg.error }); break;
      case "messagesLoaded": if (msg.data?.messages) dispatch({ type: "MESSAGES_LOADED", messages: msg.data.messages }); break;
      case "agent_turn_start": dispatch({ type: "AGENT_TURN_START", turnNumber: msg.turnNumber }); break;
      case "tool_call": dispatch({ type: "TOOL_CALL_STARTED", toolCallId: msg.toolCallId, toolName: msg.toolName, toolInput: msg.toolInput }); break;
      case "tool_approval_request": dispatch({ type: "ADD_PENDING_APPROVAL", approval: { toolCallId: msg.toolCallId, toolName: msg.toolName, toolInput: msg.toolInput, conversationId: msg.conversationId } }); break;
      case "tool_result_ack": dispatch({ type: "TOOL_CALL_COMPLETED", toolCallId: msg.toolCallId, result: msg.result, isError: msg.isError }); break;
      case "agent_complete": dispatch({ type: "AGENT_COMPLETE", usage: msg.totalUsage }); break;
      case "billing_suspended": dispatch({ type: "STREAM_ERROR", error: `__BILLING__${msg.reason}__${msg.message}` }); break;
      case "modelsLoaded": dispatch({ type: "SET_MODELS", models: msg.models, defaults: msg.defaults }); break;
    }
  }, []);

  useVsCodeMessages(handleMessage);

  if (!state.authenticated) return <LoginScreen />;

  // ── Handlers ──
  const handleSend = (content: string, images?: ImageAttachment[]) => {
    dispatch({ type: "RECORD_HISTORY", content });
    if (!state.currentConversationId) {
      dispatch({ type: "SET_PENDING", content, images });
      vscode.current.postMessage({ type: "newConversation" });
      return;
    }
    dispatch({ type: "ADD_USER_MESSAGE", content, images });
    vscode.current.postMessage({
      type: state.agentMode ? "sendAgentMessage" : "sendMessage",
      conversationId: state.currentConversationId,
      content,
      model: state.selectedModel || undefined,
      ...(state.agentMode ? { agentType: state.agentType, planMode: state.planMode } : {}),
      ...(images ? { images } : {}),
    });
  };

  /** Pull a previous user message back into the input for editing — re-sending it later. */
  const handleEditMessage = (content: string) => {
    dispatch({ type: "PREFILL_INPUT", content });
  };

  const handleCancel = () => {
    if (state.currentConversationId) {
      vscode.current.postMessage({ type: "cancelStream", conversationId: state.currentConversationId });
      dispatch({ type: "STREAM_ERROR", error: "Cancelled." });
    }
  };

  const handleApproval = (toolCallId: string, decision: "allow" | "allowAll" | "deny") => {
    dispatch({ type: "REMOVE_PENDING_APPROVAL", toolCallId });
    vscode.current.postMessage({ type: "toolApprovalResponse", toolCallId, decision });
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
        <ConversationList conversations={state.conversations} activeId={state.currentConversationId} onSelect={(id) => dispatch({ type: "SELECT_CONVERSATION", id })} />
      ) : (
        <>
          <MessageList
            messages={state.messages}
            isStreaming={state.isStreaming}
            stream={state.stream}
            pendingApprovals={state.pendingApprovals}
            onApprovalDecision={handleApproval}
            agentUsage={state.agentUsage}
            onEditMessage={handleEditMessage}
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
            agentMode={state.agentMode}
            agentType={state.agentType}
            planMode={state.planMode}
            onTogglePlanMode={() => dispatch({ type: "TOGGLE_PLAN_MODE" })}
            onToggleAgentMode={() => dispatch({ type: "TOGGLE_AGENT_MODE" })}
            onSetAgentType={(t) => dispatch({ type: "SET_AGENT_TYPE", agentType: t })}
            availableModels={state.availableModels}
            selectedModel={state.selectedModel}
            onModelChange={(m) => dispatch({ type: "SET_SELECTED_MODEL", model: m })}
            inputHistory={state.inputHistory}
            prefill={state.inputPrefill}
            onCancel={handleCancel}
          />
        </>
      )}
    </div>
  );
}
