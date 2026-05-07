import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import type { RawData } from "ws";
import { eq, asc, sql, and } from "drizzle-orm";
import type { AuthService } from "../services/AuthService.js";
import type { AIService } from "../services/AIService.js";
import type { Database } from "../config/database.js";
import { messages, conversations, aiUsageDaily } from "../models/index.js";
import type { WsClientMessage, WsServerMessage } from "@ailancers/shared-types";

/** Simple sliding-window rate limiter for AI requests per user */
class UserRateLimiter {
  private requests = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 30, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  tryConsume(userId: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const timestamps = this.requests.get(userId) ?? [];

    // Remove expired timestamps
    const valid = timestamps.filter((t) => now - t < this.windowMs);

    if (valid.length >= this.maxRequests) {
      const oldest = valid[0];
      const retryAfterMs = this.windowMs - (now - oldest);
      this.requests.set(userId, valid);
      return { allowed: false, retryAfterMs };
    }

    valid.push(now);
    this.requests.set(userId, valid);
    return { allowed: true, retryAfterMs: 0 };
  }
}

/** Pending tool call resolution — backend waits for extension to execute and reply */
interface PendingToolCall {
  resolve: (value: { result: string; isError: boolean }) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Record AI usage in ai_usage_daily — one row per user+project+date.
 * Uses SELECT-then-INSERT/UPDATE to handle NULL projectId correctly
 * (PostgreSQL unique constraints treat NULL != NULL in ON CONFLICT).
 */
async function recordAiUsage(
  db: Database,
  opts: {
    userId: string;
    projectId: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }
) {
  const today = new Date().toISOString().slice(0, 10);
  const modelKey = opts.model || "unknown";

  try {
    // Find existing row using IS NOT DISTINCT FROM (handles NULL correctly)
    const existing = await db.execute(sql`
      SELECT id, model_breakdown
      FROM ai_usage_daily
      WHERE user_id = ${opts.userId}
        AND project_id IS NOT DISTINCT FROM ${opts.projectId}
        AND date = ${today}
      LIMIT 1
    `);

    if (existing.length > 0) {
      // Update existing row
      const row = existing[0] as { id: string; model_breakdown: Record<string, unknown> | null };
      const breakdown = (row.model_breakdown || {}) as Record<string, { requests: number; inputTokens: number; outputTokens: number; costUsd: number }>;
      const prev = breakdown[modelKey];
      breakdown[modelKey] = {
        requests: (prev?.requests || 0) + 1,
        inputTokens: (prev?.inputTokens || 0) + opts.inputTokens,
        outputTokens: (prev?.outputTokens || 0) + opts.outputTokens,
        costUsd: (prev?.costUsd || 0) + opts.costUsd,
      };

      await db.execute(sql`
        UPDATE ai_usage_daily SET
          total_requests = total_requests + 1,
          total_input_tokens = total_input_tokens + ${opts.inputTokens},
          total_output_tokens = total_output_tokens + ${opts.outputTokens},
          total_cost_usd = total_cost_usd + ${opts.costUsd},
          model_breakdown = ${JSON.stringify(breakdown)}::jsonb
        WHERE id = ${row.id}
      `);
    } else {
      // Insert new row
      const breakdown = {
        [modelKey]: {
          requests: 1,
          inputTokens: opts.inputTokens,
          outputTokens: opts.outputTokens,
          costUsd: opts.costUsd,
        },
      };

      await db
        .insert(aiUsageDaily)
        .values({
          userId: opts.userId,
          projectId: opts.projectId,
          date: today,
          totalRequests: 1,
          totalInputTokens: opts.inputTokens,
          totalOutputTokens: opts.outputTokens,
          totalCostUsd: String(opts.costUsd),
          modelBreakdown: breakdown,
        });
    }
  } catch (err) {
    // Non-critical — log but don't break the chat flow
    console.error("[ai_usage_daily] Failed to record usage:", err);
  }
}

export function chatWsRoute(
  app: FastifyInstance,
  authService: AuthService,
  aiService: AIService,
  db: Database,
  billingReporter?: import("../services/BillingReporter.js").BillingReporter,
) {
  const rateLimiter = new UserRateLimiter(30, 60_000); // 30 AI requests per minute

  app.get("/api/chat/stream", { websocket: true }, async (socket: WebSocket, request) => {
    // Authenticate via query param token
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      send(socket, { type: "error", conversationId: "", error: "Missing auth token" });
      socket.close();
      return;
    }

    let userId: string;
    let platformUserId: string | undefined;
    try {
      // Try local JWT first
      try {
        const payload = authService.verifyAccessToken(token);
        userId = payload.sub;
        platformUserId = payload.platformUserId;
      } catch {
        // verifyPlatformToken has internal caching — won't call external API on every reconnect
        const payload = await authService.verifyPlatformToken(token);
        userId = payload.sub;
        platformUserId = payload.platformUserId;
      }
    } catch {
      send(socket, { type: "error", conversationId: "", error: "Invalid auth token" });
      socket.close();
      return;
    }

    console.log(`[Chat WS] User connected: userId=${userId}, platformUserId=${platformUserId || "none"}`);

    // Central-wallet pooling: when AILANCERS_BILLING_CENTRAL_LANCER_USER_ID
    // is set, every billing call (status check + usage report) uses that
    // user id instead of the actual chatter's. The platform deducts from
    // a single shared wallet for the org. Per-user attribution is still
    // preserved server-side via the `messages` table — every assistant
    // message stores inputTokens/outputTokens/costUsd keyed by user, so
    // the dashboard can build per-user reports without involving the
    // platform's billing data. Empty string = original per-user pooling.
    const centralBillingUserId = (process.env.AILANCERS_BILLING_CENTRAL_LANCER_USER_ID ?? "").trim();
    const billingLancerUserId = centralBillingUserId || platformUserId || userId;
    if (centralBillingUserId) {
      console.log(`[Chat WS] Billing pooled to central user ${centralBillingUserId} (real user is ${platformUserId || userId})`);
    }

    const abortControllers = new Map<string, AbortController>();
    // Map of pending tool calls keyed by toolCallId
    const pendingToolCalls = new Map<string, PendingToolCall>();

    socket.on("message", async (data: RawData) => {
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        send(socket, { type: "error", conversationId: "", error: "Invalid JSON" });
        return;
      }

      // ─── Cancel ───
      if (msg.type === "cancel") {
        const ac = abortControllers.get(msg.conversationId);
        if (ac) ac.abort();
        return;
      }

      // ─── Tool result from extension ───
      if (msg.type === "tool_result") {
        const pending = pendingToolCalls.get(msg.toolCallId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          pending.resolve({ result: msg.result, isError: msg.isError ?? false });
          pendingToolCalls.delete(msg.toolCallId);
          send(socket, {
            type: "tool_result_ack",
            conversationId: msg.conversationId,
            toolCallId: msg.toolCallId,
          });
        }
        return;
      }

      // ─── Regular chat message (non-agent) ───
      if (msg.type === "message") {
        const { allowed, retryAfterMs } = rateLimiter.tryConsume(userId);
        if (!allowed) {
          send(socket, { type: "rate_limited", retryAfterMs });
          return;
        }

        const ac = new AbortController();
        abortControllers.set(msg.conversationId, ac);

        try {
          // Look up projectId for usage tracking
          const [conv] = await db
            .select({ projectId: conversations.projectId })
            .from(conversations)
            .where(eq(conversations.id, msg.conversationId))
            .limit(1);
          const projectId = conv?.projectId ?? null;
          const subProjectId = (msg as { subProjectId?: string }).subProjectId ?? null;

          // Check billing status before allowing AI request
          if (billingReporter && subProjectId) {
            const billingStatus = await billingReporter.getBillingStatus(subProjectId, billingLancerUserId);
            if (billingStatus) {
              if (billingStatus.billingStatus === "SUSPENDED") {
                send(socket, {
                  type: "billing_suspended",
                  conversationId: msg.conversationId,
                  reason: "SUSPENDED",
                  message: "AI usage is suspended — wallet balance is empty. Please top up your wallet to continue.",
                });
                return;
              }
              if (billingStatus.capPercent >= 100) {
                send(socket, {
                  type: "billing_suspended",
                  conversationId: msg.conversationId,
                  reason: "CAP_REACHED",
                  message: "Daily AI usage cap reached. Usage will resume tomorrow or when the cap is increased.",
                });
                return;
              }
            }
          }

          // Save user message (store images as structured content)
          const hasImages = msg.images && msg.images.length > 0;
          await db
            .insert(messages)
            .values({
              conversationId: msg.conversationId,
              role: "user",
              content: msg.content,
              contentType: hasImages ? "structured" : "text",
            });

          // Load conversation history
          const history = await db
            .select({ role: messages.role, content: messages.content, contentType: messages.contentType })
            .from(messages)
            .where(eq(messages.conversationId, msg.conversationId))
            .orderBy(asc(messages.createdAt));

          const chatMessages = history.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

          // If the latest user message has images, build multipart content for Claude
          if (hasImages && chatMessages.length > 0) {
            const lastMsg = chatMessages[chatMessages.length - 1];
            const contentParts: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];
            for (const img of msg.images!) {
              contentParts.push({
                type: "image",
                source: { type: "base64", media_type: img.mediaType, data: img.data },
              });
            }
            contentParts.push({ type: "text", text: lastMsg.content });
            (lastMsg as { content: unknown }).content = contentParts;
          }

          // Create assistant message placeholder
          const [assistantMsg] = await db
            .insert(messages)
            .values({
              conversationId: msg.conversationId,
              role: "assistant",
              content: "",
              model: msg.model,
            })
            .returning();

          send(socket, {
            type: "stream_start",
            conversationId: msg.conversationId,
            messageId: assistantMsg.id,
          });

          const startTime = Date.now();

          await aiService.streamChat(chatMessages, {
            onDelta: (delta) => {
              send(socket, {
                type: "stream_delta",
                conversationId: msg.conversationId,
                delta,
              });
            },
            onEnd: async (result) => {
              await db
                .update(messages)
                .set({
                  content: result.fullText,
                  inputTokens: result.inputTokens,
                  outputTokens: result.outputTokens,
                  costUsd: String(result.costUsd),
                  latencyMs: Date.now() - startTime,
                })
                .where(eq(messages.id, assistantMsg.id));

              // Record in ai_usage_daily
              await recordAiUsage(db, {
                userId,
                projectId,
                model: msg.model || "claude-sonnet-4-6",
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                costUsd: result.costUsd,
              });

              // Report to ailancers billing (batched, async).
              // billingLancerUserId is the central-wallet pool when the
              // env var is set, otherwise the actual user. Real user
              // is still in our local `messages` row (userId implicit
              // via conversationId → conversation → userId), so per-user
              // analytics still work on this side.
              if (billingReporter && subProjectId) {
                billingReporter.recordUsage(
                  subProjectId,
                  billingLancerUserId,
                  msg.model || "claude-sonnet-4-6",
                  result.inputTokens,
                  result.outputTokens,
                );
              }

              send(socket, {
                type: "stream_end",
                conversationId: msg.conversationId,
                messageId: assistantMsg.id,
                usage: {
                  inputTokens: result.inputTokens,
                  outputTokens: result.outputTokens,
                  costUsd: result.costUsd,
                },
              });

              abortControllers.delete(msg.conversationId);
            },
            onError: (error) => {
              send(socket, {
                type: "error",
                conversationId: msg.conversationId,
                error,
              });
              abortControllers.delete(msg.conversationId);
            },
          }, { model: msg.model, abortSignal: ac.signal });
        } catch (err) {
          send(socket, {
            type: "error",
            conversationId: msg.conversationId,
            error: err instanceof Error ? err.message : "Internal error",
          });
          abortControllers.delete(msg.conversationId);
        }
      }

      // ─── Agent message (agentic coding mode) ───
      if (msg.type === "agent_message") {
        const { allowed, retryAfterMs } = rateLimiter.tryConsume(userId);
        if (!allowed) {
          send(socket, { type: "rate_limited", retryAfterMs });
          return;
        }

        const ac = new AbortController();
        abortControllers.set(msg.conversationId, ac);

        try {
          // Update conversation mode to agent & get projectId
          const [convRow] = await db
            .select({ projectId: conversations.projectId })
            .from(conversations)
            .where(eq(conversations.id, msg.conversationId))
            .limit(1);
          const agentProjectId = convRow?.projectId ?? null;
          const agentSubProjectId = (msg as { subProjectId?: string }).subProjectId ?? null;

          // Check billing status before allowing AI request
          if (billingReporter && agentSubProjectId) {
            const billingStatus = await billingReporter.getBillingStatus(agentSubProjectId, billingLancerUserId);
            if (billingStatus) {
              if (billingStatus.billingStatus === "SUSPENDED") {
                send(socket, {
                  type: "billing_suspended",
                  conversationId: msg.conversationId,
                  reason: "SUSPENDED",
                  message: "AI usage is suspended — wallet balance is empty. Please top up your wallet to continue.",
                });
                return;
              }
              if (billingStatus.capPercent >= 100) {
                send(socket, {
                  type: "billing_suspended",
                  conversationId: msg.conversationId,
                  reason: "CAP_REACHED",
                  message: "Daily AI usage cap reached. Usage will resume tomorrow or when the cap is increased.",
                });
                return;
              }
            }
          }

          await db
            .update(conversations)
            .set({ mode: "agent" })
            .where(eq(conversations.id, msg.conversationId));

          // Save user message
          const agentHasImages = msg.images && msg.images.length > 0;

          // Auto-context: prepend the active editor / selection block to the
          // user's content so the agent doesn't have to call read_file just to
          // know what they're looking at. Stored in DB so reloading the chat
          // shows what context the agent had.
          let storedUserContent = msg.content;
          if (msg.editorContext) {
            const ec = msg.editorContext;
            const lines: string[] = ["<editor_context>"];
            if (ec.activeFile) lines.push(`Active file: ${ec.activeFile}${ec.languageId ? ` (${ec.languageId})` : ""}`);
            if (ec.selection) {
              lines.push(`Selection (lines ${ec.selectionStart ?? "?"}-${ec.selectionEnd ?? "?"}):`);
              lines.push("```");
              lines.push(ec.selection);
              lines.push("```");
            }
            lines.push("</editor_context>");
            lines.push("");
            storedUserContent = lines.join("\n") + msg.content;
          }

          await db
            .insert(messages)
            .values({
              conversationId: msg.conversationId,
              role: "user",
              content: storedUserContent,
              contentType: agentHasImages ? "structured" : "text",
            });

          // Load conversation history — for agent mode, we need structured content.
          // /compact inserts a `role: "system"` summary at a cutoff point. We
          // honour that boundary: keep the most recent system row + every
          // message after it; drop everything before. This is how compaction
          // shrinks the model's effective context without dropping rows
          // permanently from the DB (so /export still sees the originals).
          const fullHistory = await db
            .select({
              role: messages.role,
              content: messages.content,
              contentType: messages.contentType,
            })
            .from(messages)
            .where(eq(messages.conversationId, msg.conversationId))
            .orderBy(asc(messages.createdAt));
          let history = fullHistory;
          let lastSystemIdx = -1;
          for (let i = fullHistory.length - 1; i >= 0; i--) {
            if (fullHistory[i].role === "system") { lastSystemIdx = i; break; }
          }
          if (lastSystemIdx >= 0) {
            history = fullHistory.slice(lastSystemIdx);
          }

          // Build message array — handle structured (JSON) content. The
          // Anthropic API only accepts `user` / `assistant` in the messages
          // array (system goes in the top-level `system` field), so a
          // `role: "system"` row from /compact is rendered as a `user`
          // message wrapped in a `<conversation_summary>` block. The agent
          // treats it as setup context — same effect as the role-system
          // path but without the API rejection.
          const aiMessages = history.map((m) => {
            const role = m.role === "system" ? "user" : (m.role as "user" | "assistant");
            const wrap = (txt: string) => m.role === "system"
              ? `<conversation_summary>\nThe earlier turns of this conversation have been compacted into the summary below. Treat it as the canonical context for what's already been said and decided.\n\n${txt}\n</conversation_summary>`
              : txt;
            if (m.contentType === "structured" && m.content.startsWith("[")) {
              try {
                return { role, content: JSON.parse(m.content) };
              } catch {
                return { role, content: wrap(m.content) };
              }
            }
            return { role, content: wrap(m.content) };
          });

          // If the latest user message has images, build multipart content for Claude vision
          if (agentHasImages && aiMessages.length > 0) {
            const lastAiMsg = aiMessages[aiMessages.length - 1];
            const contentParts: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];
            for (const img of msg.images!) {
              contentParts.push({
                type: "image",
                source: { type: "base64", media_type: img.mediaType, data: img.data },
              });
            }
            contentParts.push({ type: "text", text: lastAiMsg.content as string });
            (lastAiMsg as { content: unknown }).content = contentParts;
          }

          // Create assistant message placeholder
          const [assistantMsg] = await db
            .insert(messages)
            .values({
              conversationId: msg.conversationId,
              role: "assistant",
              content: "",
              model: msg.model,
              contentType: "text",
            })
            .returning();

          send(socket, {
            type: "stream_start",
            conversationId: msg.conversationId,
            messageId: assistantMsg.id,
          });

          const startTime = Date.now();

          // Run the agentic loop
          const agentResult = await aiService.runAgentLoop(
            aiMessages,
            {
              onDelta: (delta) => {
                send(socket, {
                  type: "stream_delta",
                  conversationId: msg.conversationId,
                  delta,
                });
              },
              onThinking: (delta) => {
                // Extended thinking deltas — surfaced separately so the UI
                // can render them in a collapsible "Reasoning" block.
                send(socket, {
                  type: "stream_thinking",
                  conversationId: msg.conversationId,
                  delta,
                });
              },
              onToolCall: async (toolCallId, toolName, toolInput, needsApproval) => {
                // Send tool_call to extension and wait for result
                send(socket, {
                  type: "tool_call",
                  conversationId: msg.conversationId,
                  toolCallId,
                  toolName,
                  toolInput,
                  requiresApproval: needsApproval,
                });

                // Wait for the extension to execute and send back tool_result
                return new Promise<{ result: string; isError: boolean }>((resolve, reject) => {
                  const timeoutId = setTimeout(() => {
                    pendingToolCalls.delete(toolCallId);
                    resolve({ result: "Tool execution timed out (120s)", isError: true });
                  }, 120_000);

                  pendingToolCalls.set(toolCallId, { resolve, reject, timeoutId });
                });
              },
              onTurnStart: (turnNumber) => {
                send(socket, {
                  type: "agent_turn_start",
                  conversationId: msg.conversationId,
                  turnNumber,
                });
              },
              onEnd: async (result) => {
                // Save the full assistant response with tool call metadata
                await db
                  .update(messages)
                  .set({
                    content: result.fullText,
                    inputTokens: result.usage.inputTokens,
                    outputTokens: result.usage.outputTokens,
                    costUsd: String(result.usage.costUsd),
                    latencyMs: Date.now() - startTime,
                    toolCalls: result.toolCalls.length > 0 ? JSON.stringify(result.toolCalls) : null,
                  })
                  .where(eq(messages.id, assistantMsg.id));

                // Record in ai_usage_daily
                await recordAiUsage(db, {
                  userId,
                  projectId: agentProjectId,
                  model: msg.model || "claude-sonnet-4-6",
                  inputTokens: result.usage.inputTokens,
                  outputTokens: result.usage.outputTokens,
                  costUsd: result.usage.costUsd,
                });

                // Report to ailancers billing (batched, async).
                // Central-wallet user when AILANCERS_BILLING_CENTRAL_LANCER_USER_ID is set.
                if (billingReporter && agentSubProjectId) {
                  billingReporter.recordUsage(
                    agentSubProjectId,
                    billingLancerUserId,
                    msg.model || "claude-sonnet-4-6",
                    result.usage.inputTokens,
                    result.usage.outputTokens,
                  );
                }

                send(socket, {
                  type: "stream_end",
                  conversationId: msg.conversationId,
                  messageId: assistantMsg.id,
                  usage: {
                    inputTokens: result.usage.inputTokens,
                    outputTokens: result.usage.outputTokens,
                    costUsd: result.usage.costUsd,
                  },
                });

                send(socket, {
                  type: "agent_complete",
                  conversationId: msg.conversationId,
                  totalUsage: result.usage,
                });

                abortControllers.delete(msg.conversationId);

                // Auto-title: when the conversation is still on the default
                // "New Conversation" name and the first user turn is in,
                // ask Haiku for a 4-7-word title. Best-effort — failures are
                // silent. Fires async; the WS already sent agent_complete so
                // the user isn't blocked on this.
                void (async () => {
                  try {
                    const [conv] = await db
                      .select({ title: conversations.title })
                      .from(conversations)
                      .where(eq(conversations.id, msg.conversationId))
                      .limit(1);
                    if (!conv || (conv.title && conv.title !== "New Conversation" && conv.title !== "Untitled")) return;
                    const userMsgs = await db
                      .select({ content: messages.content })
                      .from(messages)
                      .where(and(
                        eq(messages.conversationId, msg.conversationId),
                        eq(messages.role, "user"),
                      ))
                      .orderBy(asc(messages.createdAt))
                      .limit(1);
                    const firstUser = userMsgs[0]?.content ?? "";
                    if (!firstUser.trim()) return;
                    const sample = firstUser.length > 1500 ? firstUser.slice(0, 1500) + "…" : firstUser;
                    let title = "";
                    await aiService.streamChat(
                      [{
                        role: "user",
                        content:
                          "Write a 4-7-word title for a chat that started with the message below. " +
                          "Output ONLY the title — no quotes, no period, no preamble.\n\n" +
                          sample,
                      }],
                      {
                        onDelta: (text) => { title += text; },
                        onEnd: () => {},
                        onError: () => {},
                      },
                      { model: "claude-haiku-4-5" },
                    );
                    title = title.trim().replace(/^["']|["']$/g, "").slice(0, 80);
                    if (!title) return;
                    await db
                      .update(conversations)
                      .set({ title, updatedAt: new Date() })
                      .where(eq(conversations.id, msg.conversationId));
                    // Push the new title to the webview so the sidebar
                    // updates without waiting for a manual reload. Cast
                    // through `unknown` because conversation_titled isn't
                    // declared in the strict WsServerMessage union yet —
                    // older clients ignore unknown types.
                    send(socket, {
                      type: "conversation_titled",
                      conversationId: msg.conversationId,
                      title,
                    } as unknown as Parameters<typeof send>[1]);
                  } catch {
                    // Silent — auto-titling is a polish, not a critical path.
                  }
                })();
              },
              onError: (error) => {
                send(socket, {
                  type: "error",
                  conversationId: msg.conversationId,
                  error,
                });
              },
            },
            { model: msg.model, abortSignal: ac.signal, agentType: msg.agentType, projectRules: msg.projectRules, planMode: msg.planMode, effort: msg.effort }
          );

        } catch (err) {
          send(socket, {
            type: "error",
            conversationId: msg.conversationId,
            error: err instanceof Error ? err.message : "Internal error",
          });
          abortControllers.delete(msg.conversationId);
        }
      }
    });

    socket.on("close", () => {
      for (const ac of abortControllers.values()) ac.abort();
      abortControllers.clear();
      // Reject any pending tool calls
      for (const [id, pending] of pendingToolCalls) {
        clearTimeout(pending.timeoutId);
        pending.resolve({ result: "WebSocket disconnected", isError: true });
      }
      pendingToolCalls.clear();
    });
  });
}

function send(socket: WebSocket, message: WsServerMessage) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
