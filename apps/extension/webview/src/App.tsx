import { useCallback, useEffect, useReducer, useRef } from "react";
import { getVsCodeApi } from "./vscodeApi";
import { useVsCodeMessages } from "./hooks/useVsCodeMessages";
import { LoginScreen } from "./components/LoginScreen";
import { ChatToolbar } from "./components/ChatToolbar";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import { ConversationList } from "./components/ConversationList";
import { AgentStatusBar } from "./components/AgentStatusBar";
import type { ChatMessage, Conversation, IncomingMessage, TokenUsage, AgentUsage, ToolCallDisplay, AvailableModel, PendingApproval } from "./types";

interface AppState {
  authenticated: boolean;
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  showConversations: boolean;
  pendingMessage: string | null;
  // Agent mode state
  agentMode: boolean;
  agentType: "coder" | "qa" | "design";
  agentTurnNumber: number;
  agentToolCalls: ToolCallDisplay[];
  agentUsage: AgentUsage | null;
  // Model selection
  availableModels: AvailableModel[];
  selectedModel: string;
  defaultChatModel: string;
  defaultCodingModel: string;
  // Inline tool approvals
  pendingApprovals: PendingApproval[];
}

type Action =
  | { type: "SET_AUTH"; authenticated: boolean }
  | { type: "SET_CONVERSATIONS"; data: Conversation[] }
  | { type: "CONVERSATION_CREATED"; data: Conversation }
  | { type: "SELECT_CONVERSATION"; id: string }
  | { type: "MESSAGES_LOADED"; messages: ChatMessage[] }
  | { type: "ADD_USER_MESSAGE"; content: string }
  | { type: "STREAM_START" }
  | { type: "STREAM_DELTA"; delta: string }
  | { type: "STREAM_END"; usage: TokenUsage }
  | { type: "STREAM_ERROR"; error: string }
  | { type: "SET_PENDING"; content: string }
  | { type: "TOGGLE_CONVERSATIONS" }
  | { type: "TOGGLE_AGENT_MODE" }
  | { type: "SET_AGENT_TYPE"; agentType: "coder" | "qa" | "design" }
  | { type: "SET_MODELS"; models: AvailableModel[]; defaults?: { chatModel: string; codingModel: string } }
  | { type: "SET_SELECTED_MODEL"; model: string }
  // Agent actions
  | { type: "AGENT_TURN_START"; turnNumber: number }
  | { type: "TOOL_CALL_STARTED"; toolCallId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: "TOOL_CALL_COMPLETED"; toolCallId: string; result?: string; isError?: boolean }
  | { type: "AGENT_COMPLETE"; usage: AgentUsage }
  // Approval actions
  | { type: "ADD_PENDING_APPROVAL"; approval: PendingApproval }
  | { type: "REMOVE_PENDING_APPROVAL"; toolCallId: string };

const initialState: AppState = {
  authenticated: false,
  conversations: [],
  currentConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: "",
  showConversations: false,
  pendingMessage: null,
  agentMode: true, // Default to agent mode
  agentType: "coder" as const,
  agentTurnNumber: 0,
  agentToolCalls: [],
  agentUsage: null,
  availableModels: [],
  selectedModel: "",
  defaultChatModel: "",
  defaultCodingModel: "",
  pendingApprovals: [],
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_AUTH":
      return { ...state, authenticated: action.authenticated };
    case "SET_CONVERSATIONS":
      return { ...state, conversations: action.data };
    case "CONVERSATION_CREATED":
      return {
        ...state,
        conversations: [action.data, ...state.conversations],
        currentConversationId: action.data.id,
        messages: [],
        showConversations: false,
        agentToolCalls: [],
        agentTurnNumber: 0,
        agentUsage: null,
      };
    case "SELECT_CONVERSATION":
      return {
        ...state,
        currentConversationId: action.id,
        messages: [],
        showConversations: false,
        agentToolCalls: [],
        agentTurnNumber: 0,
        agentUsage: null,
      };
    case "MESSAGES_LOADED":
      return { ...state, messages: action.messages };
    case "ADD_USER_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, { role: "user", content: action.content }],
        isStreaming: true,
        streamingContent: "",
        agentToolCalls: [],
        agentTurnNumber: 0,
        agentUsage: null,
      };
    case "STREAM_START":
      return { ...state, isStreaming: true, streamingContent: "" };
    case "STREAM_DELTA":
      return { ...state, streamingContent: state.streamingContent + action.delta };
    case "STREAM_END":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            role: "assistant",
            content: state.streamingContent,
            inputTokens: action.usage.inputTokens,
            outputTokens: action.usage.outputTokens,
            costUsd: action.usage.costUsd,
            toolCalls: state.agentToolCalls.length > 0 ? [...state.agentToolCalls] : undefined,
          },
        ],
        isStreaming: false,
        streamingContent: "",
      };
    case "STREAM_ERROR":
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "assistant", content: `Error: ${action.error}` },
        ],
        isStreaming: false,
        streamingContent: "",
      };
    case "SET_PENDING":
      return { ...state, pendingMessage: action.content };
    case "TOGGLE_CONVERSATIONS":
      return { ...state, showConversations: !state.showConversations };
    case "TOGGLE_AGENT_MODE": {
      const newAgentMode = !state.agentMode;
      // Auto-switch to the right model for the mode
      const autoModel = newAgentMode
        ? (state.defaultCodingModel || state.selectedModel)
        : (state.defaultChatModel || state.selectedModel);
      return { ...state, agentMode: newAgentMode, agentType: "coder", selectedModel: autoModel };
    }
    case "SET_AGENT_TYPE":
      return { ...state, agentType: action.agentType, agentMode: true };
    case "SET_MODELS": {
      const chatDefault = action.defaults?.chatModel || action.models[0]?.id || "";
      const codeDefault = action.defaults?.codingModel || action.models[0]?.id || "";
      const autoModel = state.agentMode ? codeDefault : chatDefault;
      return {
        ...state,
        availableModels: action.models,
        selectedModel: state.selectedModel || autoModel,
        defaultChatModel: chatDefault,
        defaultCodingModel: codeDefault,
      };
    }
    case "SET_SELECTED_MODEL":
      return { ...state, selectedModel: action.model };

    // ─── Agent-specific actions ───
    case "AGENT_TURN_START":
      return { ...state, agentTurnNumber: action.turnNumber };
    case "TOOL_CALL_STARTED": {
      const newCall: ToolCallDisplay = {
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        toolInput: action.toolInput,
        status: "running",
      };
      return { ...state, agentToolCalls: [...state.agentToolCalls, newCall] };
    }
    case "TOOL_CALL_COMPLETED":
      return {
        ...state,
        agentToolCalls: state.agentToolCalls.map((tc) =>
          tc.toolCallId === action.toolCallId
            ? { ...tc, status: (action.isError ? "error" : "completed") as const, result: action.result, isError: action.isError }
            : tc
        ),
      };
    case "AGENT_COMPLETE":
      return {
        ...state,
        agentUsage: action.usage,
        isStreaming: false,
        pendingApprovals: [],
      };
    case "ADD_PENDING_APPROVAL":
      return {
        ...state,
        pendingApprovals: [...state.pendingApprovals, action.approval],
      };
    case "REMOVE_PENDING_APPROVAL":
      return {
        ...state,
        pendingApprovals: state.pendingApprovals.filter((a) => a.toolCallId !== action.toolCallId),
      };
    default:
      return state;
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const vscode = useRef(getVsCodeApi());

  // On mount, request auth state
  useEffect(() => {
    vscode.current.postMessage({ type: "getAuthState" });
  }, []);

  // When auth becomes true, load conversations and available models
  useEffect(() => {
    if (state.authenticated) {
      vscode.current.postMessage({ type: "loadConversations" });
      vscode.current.postMessage({ type: "loadModels" });
    }
  }, [state.authenticated]);

  // When a conversation is selected, load its messages
  useEffect(() => {
    if (state.currentConversationId && state.authenticated) {
      vscode.current.postMessage({
        type: "loadMessages",
        conversationId: state.currentConversationId,
      });
    }
  }, [state.currentConversationId, state.authenticated]);

  // Handle pending message after conversation is created
  useEffect(() => {
    if (state.pendingMessage && state.currentConversationId) {
      const content = state.pendingMessage;
      dispatch({ type: "ADD_USER_MESSAGE", content });
      dispatch({ type: "SET_PENDING", content: "" });
      const msgType = state.agentMode ? "sendAgentMessage" : "sendMessage";
      vscode.current.postMessage({
        type: msgType,
        conversationId: state.currentConversationId,
        content,
        model: state.selectedModel || undefined,
        ...(state.agentMode ? { agentType: state.agentType } : {}),
      });
    }
  }, [state.pendingMessage, state.currentConversationId, state.agentMode, state.agentType, state.selectedModel]);

  const handleMessage = useCallback((msg: IncomingMessage) => {
    switch (msg.type) {
      case "authState":
        dispatch({ type: "SET_AUTH", authenticated: msg.authenticated });
        break;
      case "conversations":
        dispatch({ type: "SET_CONVERSATIONS", data: msg.data });
        break;
      case "conversationCreated":
        dispatch({ type: "CONVERSATION_CREATED", data: msg.data });
        break;
      case "stream_start":
        dispatch({ type: "STREAM_START" });
        break;
      case "stream_delta":
        dispatch({ type: "STREAM_DELTA", delta: msg.delta });
        break;
      case "stream_end":
        dispatch({ type: "STREAM_END", usage: msg.usage });
        break;
      case "error":
        dispatch({ type: "STREAM_ERROR", error: msg.error });
        break;
      case "messagesLoaded":
        if (msg.data?.messages) {
          dispatch({ type: "MESSAGES_LOADED", messages: msg.data.messages });
        }
        break;
      // Agent messages
      case "agent_turn_start":
        dispatch({ type: "AGENT_TURN_START", turnNumber: msg.turnNumber });
        break;
      case "tool_call":
        dispatch({
          type: "TOOL_CALL_STARTED",
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
          toolInput: msg.toolInput,
        });
        break;
      case "tool_approval_request":
        dispatch({
          type: "ADD_PENDING_APPROVAL",
          approval: {
            toolCallId: msg.toolCallId,
            toolName: msg.toolName,
            toolInput: msg.toolInput,
            conversationId: msg.conversationId,
          },
        });
        break;
      case "tool_result_ack":
        dispatch({ type: "TOOL_CALL_COMPLETED", toolCallId: msg.toolCallId, result: msg.result, isError: msg.isError });
        break;
      case "agent_complete":
        dispatch({ type: "AGENT_COMPLETE", usage: msg.totalUsage });
        break;
      case "modelsLoaded":
        dispatch({ type: "SET_MODELS", models: msg.models, defaults: msg.defaults });
        break;
    }
  }, []);

  useVsCodeMessages(handleMessage);

  if (!state.authenticated) {
    return <LoginScreen />;
  }

  const handleSend = (content: string) => {
    if (!state.currentConversationId) {
      dispatch({ type: "SET_PENDING", content });
      vscode.current.postMessage({ type: "newConversation" });
      return;
    }
    dispatch({ type: "ADD_USER_MESSAGE", content });
    const msgType = state.agentMode ? "sendAgentMessage" : "sendMessage";
    vscode.current.postMessage({
      type: msgType,
      conversationId: state.currentConversationId,
      content,
      model: state.selectedModel || undefined,
      ...(state.agentMode ? { agentType: state.agentType } : {}),
    });
  };

  const handleCancel = () => {
    if (state.currentConversationId) {
      vscode.current.postMessage({
        type: "cancelStream",
        conversationId: state.currentConversationId,
      });
    }
  };

  const handleNewChat = () => {
    vscode.current.postMessage({ type: "newConversation" });
  };

  const handleSelectConversation = (id: string) => {
    dispatch({ type: "SELECT_CONVERSATION", id });
  };

  const handleToggleConversations = () => {
    dispatch({ type: "TOGGLE_CONVERSATIONS" });
  };

  const handleToggleAgentMode = () => {
    dispatch({ type: "TOGGLE_AGENT_MODE" });
  };

  const handleModelChange = (model: string) => {
    dispatch({ type: "SET_SELECTED_MODEL", model });
  };

  const handleApprovalDecision = (toolCallId: string, decision: "allow" | "allowAll" | "deny") => {
    dispatch({ type: "REMOVE_PENDING_APPROVAL", toolCallId });
    vscode.current.postMessage({ type: "toolApprovalResponse", toolCallId, decision });
  };

  return (
    <div className="app">
      <ChatToolbar
        title={
          state.conversations.find((c) => c.id === state.currentConversationId)?.title ??
          "New Chat"
        }
        onNewChat={handleNewChat}
        onToggleConversations={handleToggleConversations}
        showingConversations={state.showConversations}
      />
      {state.showConversations ? (
        <ConversationList
          conversations={state.conversations}
          activeId={state.currentConversationId}
          onSelect={handleSelectConversation}
        />
      ) : (
        <>
          <MessageList
            messages={state.messages}
            isStreaming={state.isStreaming}
            streamingContent={state.streamingContent}
            activeToolCalls={state.isStreaming ? state.agentToolCalls : []}
            pendingApprovals={state.pendingApprovals}
            onApprovalDecision={handleApprovalDecision}
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
            onCancel={handleCancel}
            isStreaming={state.isStreaming}
            agentMode={state.agentMode}
            agentType={state.agentType}
            onToggleAgentMode={handleToggleAgentMode}
            onSetAgentType={(t) => dispatch({ type: "SET_AGENT_TYPE", agentType: t })}
            availableModels={state.availableModels}
            selectedModel={state.selectedModel}
            onModelChange={handleModelChange}
          />
        </>
      )}
    </div>
  );
}
