import type { ApiClient } from "./ApiClient";
import type { WebSocketClient } from "./WebSocketClient";
import type { ToolExecutor } from "./ToolExecutor";
import type { ApprovalService } from "./ApprovalService";
import type { Conversation, WsServerMessage } from "@ailancers/shared-types";

type StreamCallback = (message: WsServerMessage) => void;

export class ChatService {
  private currentConversationId: string | null = null;
  private streamCallbacks: Map<string, StreamCallback> = new Map();

  constructor(
    private apiClient: ApiClient,
    private wsClient: WebSocketClient,
    private toolExecutor: ToolExecutor,
    private approvalService: ApprovalService
  ) {
    this.wsClient.onMessage((msg) => this.handleWsMessage(msg));
  }

  async createConversation(projectId?: string): Promise<Conversation> {
    const conv = await this.apiClient.post<Conversation>("/api/chat/conversations", { projectId });
    this.currentConversationId = conv.id;
    this.approvalService.resetSession();
    return conv;
  }

  async getConversations(): Promise<Conversation[]> {
    const result = await this.apiClient.get<{ data: Conversation[] }>("/api/chat/conversations");
    return result.data;
  }

  async getConversation(id: string) {
    return this.apiClient.get<{ conversation: Conversation; messages: unknown[] }>(
      `/api/chat/conversations/${id}`
    );
  }

  /** Send a regular chat message (non-agent) */
  sendMessage(conversationId: string, content: string, callback: StreamCallback, model?: string): void {
    this.streamCallbacks.set(conversationId, callback);
    this.wsClient.send({
      type: "message",
      conversationId,
      content,
      model,
    });
  }

  /** Send an agent-mode message — Claude can use tools */
  sendAgentMessage(conversationId: string, content: string, callback: StreamCallback, model?: string): void {
    this.streamCallbacks.set(conversationId, callback);
    this.wsClient.send({
      type: "agent_message",
      conversationId,
      content,
      model,
    });
  }

  cancelStream(conversationId: string): void {
    this.wsClient.send({ type: "cancel", conversationId });
    this.streamCallbacks.delete(conversationId);
  }

  private async handleWsMessage(message: WsServerMessage): Promise<void> {
    if (!("conversationId" in message)) return;

    const conversationId = (message as { conversationId: string }).conversationId;
    const callback = this.streamCallbacks.get(conversationId);

    // ─── Handle tool_call: execute locally, send result back ───
    if (message.type === "tool_call") {
      // Forward to webview for display
      if (callback) callback(message);

      const { toolCallId, toolName, toolInput, requiresApproval } = message;

      // Check approval for destructive tools
      if (requiresApproval) {
        const approved = await this.approvalService.requestApproval(toolName, toolInput);
        if (!approved) {
          // User denied — send error result back to backend
          this.wsClient.send({
            type: "tool_result",
            conversationId,
            toolCallId,
            result: "User denied this action.",
            isError: true,
          });
          return;
        }
      }

      // Execute the tool
      const { result, isError } = await this.toolExecutor.execute(toolName, toolInput);

      // Send result back to backend
      this.wsClient.send({
        type: "tool_result",
        conversationId,
        toolCallId,
        result,
        isError,
      });

      // Notify webview of completion
      if (callback) {
        callback({
          type: "tool_result_ack",
          conversationId,
          toolCallId,
        } as WsServerMessage);
      }

      return;
    }

    // ─── Forward all other messages to webview callback ───
    if (callback) {
      callback(message);

      // Clean up callback when done
      if (message.type === "stream_end" || message.type === "error" || message.type === "agent_complete") {
        this.streamCallbacks.delete(conversationId);
      }
    }
  }
}
