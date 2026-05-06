import type { Env } from "../config/env.js";
import { ClaudeProxyService } from "./ClaudeProxyService.js";
import { OpenAIProxyService } from "./OpenAIProxyService.js";
import type { StreamCallbacks, AgentCallbacks, AgentResult } from "./ClaudeProxyService.js";
import type Anthropic from "@anthropic-ai/sdk";

export type AIProvider = "anthropic" | "openai";

export interface AvailableModel {
  id: string;
  name: string;
  provider: AIProvider;
  category: "code" | "chat" | "reasoning";
}

/** All known models — Claude listed first as primary provider.
 *  `-1m` suffix variants use Anthropic's 1M context beta (`context-1m-2025-08-07`
 *  beta header). Higher per-token cost but ~5x the standard 200K context — useful
 *  for very large repos, full-conversation rewinds, or `/compact` skips. */
const ALL_MODELS: AvailableModel[] = [
  // Anthropic — PRIMARY provider
  { id: "claude-sonnet-4-6",    name: "Claude Sonnet 4.6",          provider: "anthropic", category: "code" },
  { id: "claude-sonnet-4-6-1m", name: "Claude Sonnet 4.6 (1M ctx)", provider: "anthropic", category: "code" },
  { id: "claude-opus-4-6",      name: "Claude Opus 4.6",            provider: "anthropic", category: "code" },
  { id: "claude-opus-4-6-1m",   name: "Claude Opus 4.6 (1M ctx)",   provider: "anthropic", category: "code" },
  { id: "claude-haiku-4-5",     name: "Claude Haiku 4.5",           provider: "anthropic", category: "chat" },
  // OpenAI — fallback only
  { id: "gpt-4o",            name: "GPT-4o",            provider: "openai",    category: "chat" },
  { id: "gpt-4o-mini",       name: "GPT-4o Mini",       provider: "openai",    category: "chat" },
  { id: "gpt-4.1",           name: "GPT-4.1",           provider: "openai",    category: "code" },
  { id: "gpt-4.1-mini",      name: "GPT-4.1 Mini",      provider: "openai",    category: "code" },
  { id: "o4-mini",           name: "o4-mini",           provider: "openai",    category: "reasoning" },
  { id: "o3-mini",           name: "o3-mini",           provider: "openai",    category: "reasoning" },
];

/**
 * Unified AI service — Claude (Anthropic) is always the PRIMARY provider.
 *
 * Routing rules:
 *   1. If an explicit OpenAI model ID is requested (gpt-*, o3-*, o4-*) → use OpenAI directly
 *   2. Otherwise → use Claude (claude-sonnet-4-6 as default)
 *   3. If Claude errors → automatically retry with OpenAI (if configured) as fallback
 *   4. If ANTHROPIC_API_KEY is missing → use OpenAI only
 */
export class AIService {
  private claude: ClaudeProxyService | null;
  private openai: OpenAIProxyService | null;

  constructor(env: Env) {
    this.claude = env.ANTHROPIC_API_KEY ? new ClaudeProxyService(env) : null;
    this.openai = env.OPENAI_API_KEY ? new OpenAIProxyService(env) : null;

    if (!this.claude) {
      console.warn("[AIService] ANTHROPIC_API_KEY not set — Claude unavailable. Set it in Railway environment variables.");
    }
  }

  private isOpenAIModel(model: string): boolean {
    return model.startsWith("gpt-") || model.startsWith("o1-") || model.startsWith("o3-") || model.startsWith("o4-") || model.includes("codex");
  }

  /** Get the list of available models based on configured API keys */
  getAvailableModels(): AvailableModel[] {
    return ALL_MODELS.filter((m) =>
      m.provider === "anthropic" ? !!this.claude : !!this.openai
    );
  }

  /**
   * Default models — always Claude when available.
   */
  getDefaultModels(): { chatModel: string; codingModel: string } {
    if (this.claude) {
      return { chatModel: "claude-sonnet-4-6", codingModel: "claude-sonnet-4-6" };
    }
    return { chatModel: "gpt-4o", codingModel: "gpt-4.1" };
  }

  /** Stream a chat response — Claude first, OpenAI fallback on error */
  async streamChat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    callbacks: StreamCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal }
  ) {
    const model = options?.model;

    // Explicit OpenAI model requested
    if (model && this.isOpenAIModel(model)) {
      if (!this.openai) {
        callbacks.onError("OpenAI is not configured. Set OPENAI_API_KEY.");
        return;
      }
      return this.openai.streamChat(messages, callbacks, options);
    }

    // Claude primary
    if (this.claude) {
      try {
        return await this.claude.streamChat(messages, callbacks, {
          ...options,
          model: (model && !this.isOpenAIModel(model)) ? model : "claude-sonnet-4-6",
        });
      } catch (err) {
        if (this.openai) {
          console.error("[AIService] Claude failed, falling back to OpenAI:", err);
          return this.openai.streamChat(messages, callbacks, { ...options, model: "gpt-4o" });
        }
        throw err;
      }
    }

    // No Claude — OpenAI only
    if (this.openai) {
      return this.openai.streamChat(messages, callbacks, { ...options, model: "gpt-4o" });
    }

    callbacks.onError("No AI provider configured. Set ANTHROPIC_API_KEY.");
  }

  /** Run the agentic tool-use loop — Claude primary, OpenAI fallback */
  async runAgentLoop(
    conversationMessages: Anthropic.MessageParam[] | Array<{ role: string; content: string }>,
    callbacks: AgentCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal; budgetRemainingUsd?: number; agentType?: string; projectRules?: string; planMode?: boolean; effort?: "low" | "medium" | "high" }
  ): Promise<AgentResult> {
    const empty: AgentResult = {
      fullText: "",
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, turnCount: 0, toolCallCount: 0 },
      toolCalls: [],
    };

    const model = options?.model;

    // Explicit OpenAI model requested
    if (model && this.isOpenAIModel(model)) {
      if (!this.openai) {
        callbacks.onError("OpenAI is not configured. Set OPENAI_API_KEY.");
        return empty;
      }
      const msgs = toSimpleMessages(conversationMessages);
      return this.openai.runAgentLoop(msgs, callbacks, options);
    }

    // Claude primary (native tool_use — best for agentic loops)
    if (this.claude) {
      try {
        return await this.claude.runAgentLoop(
          conversationMessages as Anthropic.MessageParam[],
          callbacks,
          {
            ...options,
            model: (model && !this.isOpenAIModel(model)) ? model : "claude-sonnet-4-6",
          }
        );
      } catch (err) {
        if (this.openai) {
          console.error("[AIService] Claude agent failed, falling back to OpenAI:", err);
          callbacks.onError("Claude unavailable — switching to OpenAI fallback.");
          const msgs = toSimpleMessages(conversationMessages);
          return this.openai.runAgentLoop(msgs, callbacks, { ...options, model: "gpt-4.1" });
        }
        throw err;
      }
    }

    // No Claude — OpenAI only
    if (this.openai) {
      const msgs = toSimpleMessages(conversationMessages);
      return this.openai.runAgentLoop(msgs, callbacks, { ...options, model: "gpt-4.1" });
    }

    callbacks.onError("No AI provider configured. Set ANTHROPIC_API_KEY.");
    return empty;
  }

  /** Calculate cost for a model */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    if (this.isOpenAIModel(model) && this.openai) {
      return this.openai.calculateCost(model, inputTokens, outputTokens);
    }
    if (this.claude) {
      return this.claude.calculateCost(model, inputTokens, outputTokens);
    }
    return 0;
  }
}

function toSimpleMessages(
  msgs: Anthropic.MessageParam[] | Array<{ role: string; content: unknown }>
): Array<{ role: string; content: string }> {
  return (msgs as Array<{ role: string; content: unknown }>).map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
}
