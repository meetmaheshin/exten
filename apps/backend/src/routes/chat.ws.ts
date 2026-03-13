import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import type { RawData } from "ws";
import { eq, asc, sql } from "drizzle-orm";
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
  db: Database
) {
  const rateLimiter = new UserRateLimiter(30, 60_000); // 30 AI requests per minute

  app.get("/api/chat/stream", { websocket: true }, (socket: WebSocket, request) => {
    // Authenticate via query param token
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      send(socket, { type: "error", conversationId: "", error: "Missing auth token" });
      socket.close();
      return;
    }

    let userId: string;
    try {
      const payload = authService.verifyAccessToken(token);
      userId = payload.sub;
    } catch {
      send(socket, { type: "error", conversationId: "", error: "Invalid auth token" });
      socket.close();
      return;
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

          // Save user message
          await db
            .insert(messages)
            .values({
              conversationId: msg.conversationId,
              role: "user",
              content: msg.content,
            });

          // Load conversation history
          const history = await db
            .select({ role: messages.role, content: messages.content })
            .from(messages)
            .where(eq(messages.conversationId, msg.conversationId))
            .orderBy(asc(messages.createdAt));

          const chatMessages = history.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

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
                model: msg.model || "default",
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                costUsd: result.costUsd,
              });

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

          await db
            .update(conversations)
            .set({ mode: "agent" })
            .where(eq(conversations.id, msg.conversationId));

          // Save user message
          await db
            .insert(messages)
            .values({
              conversationId: msg.conversationId,
              role: "user",
              content: msg.content,
              contentType: "text",
            });

          // Load conversation history — for agent mode, we need structured content
          const history = await db
            .select({
              role: messages.role,
              content: messages.content,
              contentType: messages.contentType,
            })
            .from(messages)
            .where(eq(messages.conversationId, msg.conversationId))
            .orderBy(asc(messages.createdAt));

          // Build message array — handle structured (JSON) content
          const aiMessages = history.map((m) => {
            if (m.contentType === "structured" && m.content.startsWith("[")) {
              try {
                return { role: m.role as "user" | "assistant", content: JSON.parse(m.content) };
              } catch {
                return { role: m.role as "user" | "assistant", content: m.content };
              }
            }
            return { role: m.role as "user" | "assistant", content: m.content };
          });

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
                  model: msg.model || "default",
                  inputTokens: result.usage.inputTokens,
                  outputTokens: result.usage.outputTokens,
                  costUsd: result.usage.costUsd,
                });

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
              },
              onError: (error) => {
                send(socket, {
                  type: "error",
                  conversationId: msg.conversationId,
                  error,
                });
              },
            },
            { model: msg.model, abortSignal: ac.signal, agentType: msg.agentType }
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
