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

/** All known models — only models whose provider key is configured will be available */
const ALL_MODELS: AvailableModel[] = [
  // Anthropic
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", category: "code" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", category: "code" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", category: "chat" },
  // OpenAI — Code-optimized
  { id: "codex-mini-latest", name: "Codex Mini (Code)", provider: "openai", category: "code" },
  { id: "gpt-4.1", name: "GPT-4.1 (Code)", provider: "openai", category: "code" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai", category: "chat" },
  // OpenAI — Chat / Reasoning
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", category: "chat" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", category: "chat" },
  { id: "o4-mini", name: "o4-mini (Reasoning)", provider: "openai", category: "reasoning" },
  { id: "o3-mini", name: "o3-mini (Reasoning)", provider: "openai", category: "reasoning" },
];

/**
 * Unified AI service that routes requests to Claude or OpenAI
 * based on the selected model.
 */
export class AIService {
  private claude: ClaudeProxyService;
  private openai: OpenAIProxyService | null;
  private openaiEnabled: boolean;
  private defaultModel: string;

  private anthropicEnabled: boolean;

  constructor(env: Env) {
    this.anthropicEnabled = !!env.ANTHROPIC_API_KEY;
    this.claude = this.anthropicEnabled ? new ClaudeProxyService(env) : (null as unknown as ClaudeProxyService);
    this.openaiEnabled = !!env.OPENAI_API_KEY;
    this.openai = this.openaiEnabled ? new OpenAIProxyService(env) : null;
    this.defaultModel = env.ANTHROPIC_DEFAULT_MODEL;
  }

  /** Get the list of models available based on configured API keys */
  getAvailableModels(): AvailableModel[] {
    return ALL_MODELS.filter((m) => {
      if (m.provider === "openai") return this.openaiEnabled;
      if (m.provider === "anthropic") return this.anthropicEnabled;
      return false;
    });
  }

  /** Detect provider from model ID */
  private getProvider(model?: string): AIProvider {
    const m = model || this.defaultModel;
    if (m.startsWith("gpt-") || m.startsWith("o1-") || m.startsWith("o3-") || m.startsWith("o4-") || m.includes("codex")) {
      return "openai";
    }
    return "anthropic";
  }

  /** Stream a simple chat response */
  async streamChat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    callbacks: StreamCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal }
  ) {
    const provider = this.getProvider(options?.model);

    if (provider === "openai") {
      if (!this.openai) {
        callbacks.onError("OpenAI is not configured. Set OPENAI_API_KEY in your environment.");
        return;
      }
      return this.openai.streamChat(messages, callbacks, options);
    }

    if (!this.anthropicEnabled) {
      callbacks.onError("Anthropic is not configured. Set ANTHROPIC_API_KEY in your environment.");
      return;
    }
    return this.claude.streamChat(messages, callbacks, options);
  }

  /** Run the agentic coding loop */
  async runAgentLoop(
    conversationMessages: Anthropic.MessageParam[] | Array<{ role: string; content: string }>,
    callbacks: AgentCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal; budgetRemainingUsd?: number }
  ): Promise<AgentResult> {
    const provider = this.getProvider(options?.model);

    if (provider === "openai") {
      if (!this.openai) {
        callbacks.onError("OpenAI is not configured. Set OPENAI_API_KEY in your environment.");
        return { fullText: "", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, turnCount: 0, toolCallCount: 0 }, toolCalls: [] };
      }
      // Convert Anthropic format to simple format for OpenAI
      const simpleMessages = (conversationMessages as Array<{ role: string; content: unknown }>).map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));
      return this.openai.runAgentLoop(simpleMessages, callbacks, options);
    }

    if (!this.anthropicEnabled) {
      callbacks.onError("Anthropic is not configured. Set ANTHROPIC_API_KEY in your environment.");
      return { fullText: "", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, turnCount: 0, toolCallCount: 0 }, toolCalls: [] };
    }
    return this.claude.runAgentLoop(conversationMessages as Anthropic.MessageParam[], callbacks, options);
  }

  /** Calculate cost for a model */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const provider = this.getProvider(model);
    if (provider === "openai" && this.openai) {
      return this.openai.calculateCost(model, inputTokens, outputTokens);
    }
    return this.claude.calculateCost(model, inputTokens, outputTokens);
  }
}
