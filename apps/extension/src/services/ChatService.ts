import type { ApiClient } from "./ApiClient";
import type { WebSocketClient } from "./WebSocketClient";
import type { ToolExecutor } from "./ToolExecutor";
import type { ApprovalService } from "./ApprovalService";
import type { Conversation, WsServerMessage } from "@ailancers/shared-types";

type StreamCallback = (message: WsServerMessage) => void;

export class ChatService {
  private currentConversationId: string | null = null;
  private streamCallbacks: Map<string, StreamCallback> = new Map();
  /** Pending inline approval promises keyed by toolCallId */
  private pendingApprovals: Map<string, { resolve: (decision: "allow" | "allowAll" | "deny") => void }> = new Map();
  /** Tools auto-approved for the rest of the session via "Allow All" */
  private sessionAutoApproved = new Set<string>();

  constructor(
    private apiClient: ApiClient,
    private wsClient: WebSocketClient,
    private toolExecutor: ToolExecutor,
    private approvalService: ApprovalService
  ) {
    this.wsClient.onMessage((msg) => this.handleWsMessage(msg));
  }

  /** Called by ChatViewProvider when webview sends an approval decision */
  resolveApproval(toolCallId: string, decision: "allow" | "allowAll" | "deny"): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (pending) {
      pending.resolve(decision);
      this.pendingApprovals.delete(toolCallId);
    }
  }

  async createConversation(projectId?: string): Promise<Conversation> {
    const conv = await this.apiClient.post<Conversation>("/api/chat/conversations", { projectId });
    this.currentConversationId = conv.id;
    this.approvalService.resetSession();
    this.sessionAutoApproved.clear();
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
  sendMessage(conversationId: string, content: string, callback: StreamCallback, model?: string, images?: unknown[]): void {
    this.streamCallbacks.set(conversationId, callback);
    this.wsClient.send({
      type: "message",
      conversationId,
      content,
      model,
      ...(images ? { images } : {}),
    } as import("@ailancers/shared-types").WsClientMessage);
  }

  /** Send an agent-mode message — Claude can use tools */
  sendAgentMessage(conversationId: string, content: string, callback: StreamCallback, model?: string, agentType?: "coder" | "qa", images?: unknown[]): void {
    this.streamCallbacks.set(conversationId, callback);
    this.wsClient.send({
      type: "agent_message",
      conversationId,
      content,
      model,
      agentType,
      ...(images ? { images } : {}),
    } as import("@ailancers/shared-types").WsClientMessage);
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

      // Check approval for destructive tools — use inline webview approval
      if (requiresApproval && !this.sessionAutoApproved.has(toolName)) {
        // Send approval request to webview
        if (callback) {
          callback({
            type: "tool_approval_request",
            conversationId,
            toolCallId,
            toolName,
            toolInput,
          } as unknown as WsServerMessage);
        }

        // Wait for user decision from webview (timeout after 5 minutes)
        const decision = await new Promise<"allow" | "allowAll" | "deny">((resolve) => {
          this.pendingApprovals.set(toolCallId, { resolve });
          setTimeout(() => {
            if (this.pendingApprovals.has(toolCallId)) {
              this.pendingApprovals.delete(toolCallId);
              resolve("deny");
            }
          }, 5 * 60 * 1000);
        });

        if (decision === "allowAll") {
          this.sessionAutoApproved.add(toolName);
        }

        if (decision === "deny") {
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

      // Execute the tool (2-minute timeout to prevent agent hanging)
      const TOOL_TIMEOUT_MS = 2 * 60 * 1000;
      const toolPromise = this.toolExecutor.execute(toolName, toolInput);
      const timeoutPromise = new Promise<{ result: string; isError: boolean }>((resolve) =>
        setTimeout(() => resolve({ result: `Tool execution timed out after 2 minutes.`, isError: true }), TOOL_TIMEOUT_MS)
      );
      const { result, isError } = await Promise.race([toolPromise, timeoutPromise]);

      // Send result back to backend
      this.wsClient.send({
        type: "tool_result",
        conversationId,
        toolCallId,
        result,
        isError,
      });

      // Notify webview of completion with result
      if (callback) {
        callback({
          type: "tool_result_ack",
          conversationId,
          toolCallId,
          result,
          isError,
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
