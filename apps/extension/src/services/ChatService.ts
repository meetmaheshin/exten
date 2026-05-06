import * as vscode from "vscode";
import type { ApiClient } from "./ApiClient";
import type { WebSocketClient } from "./WebSocketClient";
import type { ToolExecutor } from "./ToolExecutor";
import type { SettingsLoader } from "./SettingsLoader";
import type { HookRunner } from "./HookRunner";
import { evaluatePermission } from "./PermissionEvaluator";
import { PermissionAuditLog } from "./PermissionAuditLog";
import type { Conversation, WsServerMessage } from "@ailancers/shared-types";

type StreamCallback = (message: WsServerMessage) => void;

export class ChatService {
  private currentConversationId: string | null = null;
  private streamCallbacks: Map<string, StreamCallback> = new Map();
  /** Pending inline approval promises keyed by toolCallId. The resolution
   *  carries an optional `editedInput` that, when present, replaces the
   *  agent's original `toolInput` before the tool runs. Used by the
   *  "Edit & approve" workflow on edit_file / write_file. */
  private pendingApprovals: Map<
    string,
    { resolve: (decision: { kind: "allow" | "allowAll" | "deny"; editedInput?: Record<string, unknown> }) => void }
  > = new Map();
  /** Original tool input snapshots, keyed by toolCallId. Held while an
   *  approval is pending so the "Edit & approve" path can compute the
   *  diff against the original to decide whether to substitute. Cleared
   *  on resolve. */
  private pendingApprovalInputs: Map<string, Record<string, unknown>> = new Map();
  /** Tools auto-approved for the rest of the session via "Allow All" */
  private sessionAutoApproved = new Set<string>();
  /** Per-conversation abort controller for in-flight tools — fired on cancel */
  private toolAbortControllers: Map<string, AbortController> = new Map();
  /** Conversations that have already fired SessionStart hooks. We only fire
   *  once per chat lifetime — a user message in the same conversation that
   *  comes hours later doesn't re-trigger. */
  private sessionsStarted = new Set<string>();
  /** Conversations currently streaming. Used to drive the `ailancersIsStreaming`
   *  VS Code context key so keybindings (Esc to cancel) only fire when relevant. */
  private streamingIds: Set<string> = new Set();

  private setStreamingContext(): void {
    void vscode.commands.executeCommand("setContext", "ailancersIsStreaming", this.streamingIds.size > 0);
  }

  private projectPicker?: import("./ProjectPickerService").ProjectPickerService;
  private workspaceContext?: import("./WorkspaceContextService").WorkspaceContextService;

  /** Optional settings loader — when provided, persisted allow/deny/ask rules
   *  override the backend's default `requiresApproval` decision. */
  private settingsLoader?: SettingsLoader;
  /** Optional hook runner — when provided, PreToolUse / PostToolUse hooks
   *  fire around each tool execution. Hooks can deny / ask / allow / inject
   *  additional context. */
  private hookRunner?: HookRunner;

  /** Permission decision audit log — appends every tool decision to
   *  `.ailancers/audit.log` (JSONL). Stays on even when no settings rules
   *  are configured: every prompt-and-allow / session-allow / fallback-allow
   *  is recorded so the user can review what their agent has been doing. */
  private auditLog = new PermissionAuditLog();

  constructor(
    private apiClient: ApiClient,
    private wsClient: WebSocketClient,
    private toolExecutor: ToolExecutor
  ) {
    this.wsClient.onMessage((msg) => this.handleWsMessage(msg));
  }

  setSettingsLoader(loader: SettingsLoader): void {
    this.settingsLoader = loader;
  }

  setHookRunner(runner: HookRunner): void {
    this.hookRunner = runner;
  }

  /** Expose the audit log so the host can open `.ailancers/audit.log` from a
   *  slash command (`/permissions log`) or palette command. */
  getPermissionAuditLog(): PermissionAuditLog {
    return this.auditLog;
  }

  /** Apply the unified permission-mode picker. Plan mode is handled in the
   *  send path (a flag on `WsAgentMessage`); the other two pre-populate the
   *  session auto-approve set so the user isn't prompted for every operation
   *  matching the mode. Resetting to default clears the session set —
   *  conservative since the user may not realise allow-all-this-chat from a
   *  prior toggle is still active. */
  setPermissionMode(mode: "default" | "plan" | "accept-edits" | "bypass"): void {
    if (mode === "default" || mode === "plan") {
      this.sessionAutoApproved.clear();
      return;
    }
    if (mode === "accept-edits") {
      this.sessionAutoApproved.add("edit_file");
      this.sessionAutoApproved.add("write_file");
      this.sessionAutoApproved.add("read_file");
      this.sessionAutoApproved.add("list_directory");
      this.sessionAutoApproved.add("glob_files");
      this.sessionAutoApproved.add("search_files");
      return;
    }
    if (mode === "bypass") {
      // Add every tool name we currently support. The set gates *prompt*,
      // not execution — settings deny rules + hooks still apply. Keep this
      // list synced with shared-types' `ToolName` union.
      const all = [
        "read_file",
        "write_file",
        "edit_file",
        "run_terminal",
        "search_files",
        "list_directory",
        "glob_files",
        "find_symbol",
        "figma_read",
        "get_diagnostics",
      ];
      for (const t of all) this.sessionAutoApproved.add(t);
    }
  }

  setWorkspaceContext(svc: import("./WorkspaceContextService").WorkspaceContextService): void {
    this.workspaceContext = svc;
  }

  /** Called by ChatViewProvider when webview sends an approval decision.
   *  `editedInput`, when present, is merged into the original tool input
   *  before the tool runs — used by the "Edit & approve" workflow on
   *  edit_file / write_file. */
  resolveApproval(
    toolCallId: string,
    decision: "allow" | "allowAll" | "deny",
    editedInput?: Record<string, unknown>,
  ): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (pending) {
      pending.resolve({ kind: decision, editedInput });
      this.pendingApprovals.delete(toolCallId);
      this.pendingApprovalInputs.delete(toolCallId);
    }
  }

  /** Lookup the original tool input for a pending approval — used by the
   *  ChatViewProvider's "Edit & approve" handler to seed the untitled doc. */
  getPendingApprovalInput(toolCallId: string): Record<string, unknown> | null {
    return this.pendingApprovalInputs.get(toolCallId) ?? null;
  }

  async createConversation(projectId?: string): Promise<Conversation> {
    const conv = await this.apiClient.post<Conversation>("/api/chat/conversations", { projectId });
    this.currentConversationId = conv.id;
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

  setProjectPicker(picker: import("./ProjectPickerService").ProjectPickerService): void {
    this.projectPicker = picker;
  }

  /** Send a regular chat message (non-agent) */
  sendMessage(conversationId: string, content: string, callback: StreamCallback, model?: string, images?: unknown[]): void {
    this.streamCallbacks.set(conversationId, callback);
    this.streamingIds.add(conversationId);
    this.setStreamingContext();
    this.wsClient.send({
      type: "message",
      conversationId,
      content,
      model,
      subProjectId: this.projectPicker?.activeSubProjectId ?? null,
      ...(images ? { images } : {}),
    } as import("@ailancers/shared-types").WsClientMessage);
  }

  /** Send an agent-mode message — Claude can use tools */
  async sendAgentMessage(conversationId: string, content: string, callback: StreamCallback, opts?: { model?: string; agentType?: import("@ailancers/shared-types").AgentType; images?: unknown[]; planMode?: boolean; excludeEditorContext?: boolean; effort?: "low" | "medium" | "high" }): Promise<void> {
    this.streamCallbacks.set(conversationId, callback);
    this.streamingIds.add(conversationId);
    this.setStreamingContext();

    // Save dirty editors before the agent reads/writes — prevents stale-file
    // edits where the agent reads disk but the user has unsaved changes.
    const cfg = vscode.workspace.getConfiguration("ailancers");
    if (cfg.get<boolean>("autosaveBeforeAgent", true)) {
      try { await vscode.workspace.saveAll(false); } catch { /* best-effort */ }
    }

    // Auto-context: rules cascade (user → project-team → project-local) +
    // active editor / selection. All best-effort — missing files just don't
    // contribute. Order matters: user rules apply across all projects, project
    // rules override them, gitignored personal rules override both.
    const userRules = this.workspaceContext ? await this.workspaceContext.getUserRules() : "";
    const teamRules = this.workspaceContext ? await this.workspaceContext.getProjectRules() : "";
    // Path-scoped rules: opt-in `.ailancers/rules/*.md` files with `paths:`
    // frontmatter. Only the rules whose paths globs match the active editor
    // are included — keeps the system prompt budget small for big repos.
    const editor = vscode.window.activeTextEditor;
    let activeRelPath: string | undefined;
    if (editor) {
      const folders = vscode.workspace.workspaceFolders;
      const root = folders?.[0]?.uri.fsPath;
      if (root && editor.document.uri.fsPath.startsWith(root)) {
        activeRelPath = require("node:path").relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
      } else {
        activeRelPath = editor.document.uri.fsPath.replace(/\\/g, "/");
      }
    }
    const scopedRules = this.workspaceContext ? await this.workspaceContext.getPathScopedRules(activeRelPath) : "";
    const localRules = this.workspaceContext ? await this.workspaceContext.getLocalProjectRules() : "";
    const projectRules = [userRules, teamRules, scopedRules, localRules].filter(Boolean).join("\n\n---\n\n");
    const editorContext = (opts?.excludeEditorContext || !this.workspaceContext)
      ? undefined
      : this.workspaceContext.getEditorContext();

    // ── Hooks v2: SessionStart + UserPromptSubmit ────────────────────────
    // SessionStart fires once per conversation; its `additionalContext` is
    // prepended to the user's first message (so the model sees it as setup
    // rather than as a separate role-system block). UserPromptSubmit fires
    // every turn before the message goes out; it can block (exit-2) to
    // refuse the message entirely, or inject `additionalContext`.
    const settings = this.settingsLoader?.getSettings() ?? null;
    const ctxBlocks: string[] = [];
    if (this.hookRunner && settings) {
      if (!this.sessionsStarted.has(conversationId)) {
        this.sessionsStarted.add(conversationId);
        const sessionStart = await this.hookRunner.runSessionStart(settings);
        if (sessionStart.additionalContext) {
          ctxBlocks.push(`<hook_context source="SessionStart">\n${sessionStart.additionalContext}\n</hook_context>`);
        }
      }
      const userPrompt = await this.hookRunner.runUserPromptSubmit(settings, content);
      if (userPrompt.block) {
        // Surface the block reason as an inline assistant error so the user
        // knows their message wasn't sent — no token spend, no stream.
        const reason = `Blocked by UserPromptSubmit hook: ${userPrompt.block.reason}`;
        const cb = this.streamCallbacks.get(conversationId);
        if (cb) {
          cb({
            type: "error",
            conversationId,
            error: reason,
          } as import("@ailancers/shared-types").WsServerMessage);
        }
        this.streamingIds.delete(conversationId);
        this.setStreamingContext();
        return;
      }
      if (userPrompt.additionalContext) {
        ctxBlocks.push(`<hook_context source="UserPromptSubmit">\n${userPrompt.additionalContext}\n</hook_context>`);
      }
    }
    const augmentedContent = ctxBlocks.length > 0
      ? `${ctxBlocks.join("\n\n")}\n\n${content}`
      : content;

    this.wsClient.send({
      type: "agent_message",
      conversationId,
      content: augmentedContent,
      model: opts?.model,
      agentType: opts?.agentType,
      subProjectId: this.projectPicker?.activeSubProjectId ?? null,
      ...(opts?.images ? { images: opts.images } : {}),
      ...(opts?.planMode ? { planMode: true } : {}),
      ...(opts?.effort ? { effort: opts.effort } : {}),
      ...(projectRules ? { projectRules } : {}),
      ...(editorContext ? { editorContext } : {}),
    } as import("@ailancers/shared-types").WsClientMessage);
  }

  cancelStream(conversationId: string): void {
    this.wsClient.send({ type: "cancel", conversationId });
    this.streamCallbacks.delete(conversationId);
    this.streamingIds.delete(conversationId);
    this.setStreamingContext();
    // Kill any in-flight tool (run_terminal child process etc.) so a click on
    // Stop actually stops local work, not just the upstream model stream.
    const ctrl = this.toolAbortControllers.get(conversationId);
    if (ctrl && !ctrl.signal.aborted) ctrl.abort();
    this.toolAbortControllers.delete(conversationId);
    // Resolve any pending approval as "deny" so the agent loop unblocks
    for (const [id, p] of this.pendingApprovals) {
      p.resolve({ kind: "deny" });
      this.pendingApprovals.delete(id);
      this.pendingApprovalInputs.delete(id);
    }
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

      const settings = this.settingsLoader?.getSettings() ?? null;

      // Make sure we have an abort controller — needed by both hook execution
      // and the tool itself, so allocate it up-front.
      let abortCtrl = this.toolAbortControllers.get(conversationId);
      if (!abortCtrl || abortCtrl.signal.aborted) {
        abortCtrl = new AbortController();
        this.toolAbortControllers.set(conversationId, abortCtrl);
      }

      // ── PreToolUse hooks ─────────────────────────────────────────────
      // Hooks run BEFORE the permission evaluator so they can override the
      // user's persisted allow/deny rules (e.g. a `lint-on-edit` hook that
      // blocks bad edits regardless of any allow rule). Exit-2 short-circuits
      // with a denial reason — the tool never runs.
      const preHook = this.hookRunner
        ? await this.hookRunner.runPreToolUse(settings, toolName, toolInput, abortCtrl.signal)
        : {} as { permissionDecision?: "allow" | "ask" | "deny"; additionalContext?: string; block?: { reason: string } };

      if (preHook.block) {
        const reason = `Blocked by PreToolUse hook: ${preHook.block.reason}`;
        this.auditLog.append({
          tool: toolName,
          input: toolInput,
          source: "hook",
          decision: "deny",
          reason: preHook.block.reason,
        });
        this.wsClient.send({ type: "tool_result", conversationId, toolCallId, result: reason, isError: true });
        if (callback) {
          callback({ type: "tool_result_ack", conversationId, toolCallId, result: reason, isError: true } as WsServerMessage);
        }
        return;
      }

      // Consult the user's persisted allow/deny/ask rules. Hook decisions take
      // priority over rule decisions (deny > ask > allow). Order:
      //   • hook deny       → refuse the tool, return error to model
      //   • hook ask        → force a prompt even if rule said allow
      //   • hook allow      → skip prompt even if rule said ask/none
      //   • settings deny   → refuse the tool
      //   • settings ask    → force a prompt
      //   • settings allow  → skip prompt
      //   • else            → fall through to backend's `requiresApproval`
      const ruleDecision = evaluatePermission(settings, toolName, toolInput);
      const finalDecision: "deny" | "ask" | "allow" | null =
        preHook.permissionDecision ?? ruleDecision;

      if (finalDecision === "deny") {
        const denyMsg = preHook.permissionDecision === "deny"
          ? "Blocked by a PreToolUse hook."
          : "Blocked by your .ailancers/settings.json deny rule.";
        this.auditLog.append({
          tool: toolName,
          input: toolInput,
          source: preHook.permissionDecision === "deny" ? "hook" : "rule",
          decision: "deny",
          reason: denyMsg,
        });
        this.wsClient.send({
          type: "tool_result",
          conversationId,
          toolCallId,
          result: denyMsg,
          isError: true,
        });
        if (callback) {
          callback({
            type: "tool_result_ack",
            conversationId,
            toolCallId,
            result: denyMsg,
            isError: true,
          } as WsServerMessage);
        }
        return;
      }
      const shouldPrompt =
        finalDecision === "ask" ||
        (finalDecision !== "allow" && requiresApproval && !this.sessionAutoApproved.has(toolName));

      // Check approval for destructive tools — use inline webview approval
      if (shouldPrompt) {
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

        // Stash the original input so the "Edit & approve" path can read it.
        this.pendingApprovalInputs.set(toolCallId, toolInput);

        // Wait for user decision from webview (timeout after 5 minutes)
        const result = await new Promise<{ kind: "allow" | "allowAll" | "deny"; editedInput?: Record<string, unknown> }>((resolve) => {
          this.pendingApprovals.set(toolCallId, { resolve });
          setTimeout(() => {
            if (this.pendingApprovals.has(toolCallId)) {
              this.pendingApprovals.delete(toolCallId);
              this.pendingApprovalInputs.delete(toolCallId);
              resolve({ kind: "deny" });
            }
          }, 5 * 60 * 1000);
        });
        const decision = result.kind;
        // If the user picked "Edit & approve" the webview sent edited input
        // along with allow. Merge it into the toolInput we'll execute.
        if (result.editedInput) {
          for (const [k, v] of Object.entries(result.editedInput)) {
            (toolInput as Record<string, unknown>)[k] = v;
          }
        }

        if (decision === "allowAll") {
          this.sessionAutoApproved.add(toolName);
        }

        this.auditLog.append({
          tool: toolName,
          input: toolInput,
          source: "prompt",
          decision: decision === "deny" ? "deny" : "allow",
          userChoice: decision,
          ...(result.editedInput ? { reason: "user edited proposed content before approving" } : {}),
        });

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
      } else {
        // Implicit allow (no prompt fired). Differentiate "rule said allow"
        // from "session-allowed via Allow-All" from "fell through to backend
        // requiresApproval=false".
        const source: "rule" | "hook" | "session-allow" | "fallback-allow" =
          preHook.permissionDecision === "allow" ? "hook"
          : finalDecision === "allow" ? "rule"
          : this.sessionAutoApproved.has(toolName) ? "session-allow"
          : "fallback-allow";
        this.auditLog.append({
          tool: toolName,
          input: toolInput,
          source,
          decision: "allow",
        });
      }

      // Execute the tool (2-minute timeout to prevent agent hanging).
      // The abortCtrl was already allocated above for hook execution — reuse
      // it so Stop also kills the spawned bash child / short-circuits writes.
      const TOOL_TIMEOUT_MS = 2 * 60 * 1000;
      const toolPromise = this.toolExecutor.execute(toolName, toolInput, abortCtrl.signal);
      const timeoutPromise = new Promise<{ result: string; isError: boolean }>((resolve) =>
        setTimeout(() => resolve({ result: `Tool execution timed out after 2 minutes.`, isError: true }), TOOL_TIMEOUT_MS)
      );
      let { result, isError } = await Promise.race([toolPromise, timeoutPromise]);

      // ── PreToolUse `additionalContext` ────────────────────────────────
      // If a PreToolUse hook returned context, prepend it to the result the
      // model sees so the agent can react to it (e.g. linter pre-warnings).
      if (preHook.additionalContext) {
        result = `<hook_context source="PreToolUse">\n${preHook.additionalContext}\n</hook_context>\n\n${result}`;
      }

      // ── PostToolUse hooks ────────────────────────────────────────────
      // Run AFTER the tool completes. Cannot block (the tool already ran),
      // but can append `additionalContext` for the model to see — useful for
      // post-edit linting, secret-scanning shell output, etc.
      if (this.hookRunner) {
        const postHook = await this.hookRunner.runPostToolUse(
          settings,
          toolName,
          toolInput,
          { result, isError },
          abortCtrl.signal,
        );
        if (postHook.additionalContext) {
          result = `${result}\n\n<hook_context source="PostToolUse">\n${postHook.additionalContext}\n</hook_context>`;
        }
      }

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

      // Clean up callback + abort controller when done
      if (message.type === "stream_end" || message.type === "error" || message.type === "agent_complete" || message.type === "billing_suspended") {
        this.streamCallbacks.delete(conversationId);
        this.toolAbortControllers.delete(conversationId);
        this.streamingIds.delete(conversationId);
        this.setStreamingContext();
      }
    }
  }
}
