import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../config/env.js";
import { AGENT_TOOL_DEFINITIONS, AGENT_SYSTEM_PROMPT, QA_SYSTEM_PROMPT, DESIGN_REVIEW_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT, requiresApproval } from "./agentTools.js";
import type { AgentUsage, ToolCallSummary } from "@ailancers/shared-types";

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

// ─── Callback interfaces ─────────────────────────────────────────

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onEnd: (result: { inputTokens: number; outputTokens: number; costUsd: number; fullText: string }) => void;
  onError: (error: string) => void;
}

export interface AgentCallbacks {
  /** Text chunk from Claude — append to chat UI */
  onDelta: (text: string) => void;
  /** Claude wants to call a tool — extension executes and returns result */
  onToolCall: (toolCallId: string, toolName: string, toolInput: Record<string, unknown>, needsApproval: boolean) => Promise<{ result: string; isError: boolean }>;
  /** New turn started */
  onTurnStart: (turnNumber: number) => void;
  /** Agent finished */
  onEnd: (result: AgentResult) => void;
  /** Error occurred */
  onError: (error: string) => void;
}

export interface AgentResult {
  fullText: string;
  usage: AgentUsage;
  toolCalls: ToolCallSummary[];
}

// ─── Service ─────────────────────────────────────────────────────

export class ClaudeProxyService {
  private client: Anthropic;
  private defaultModel: string;
  private maxTokens: number;
  private agentMaxTokens: number;
  private agentMaxTurns: number;

  constructor(env: Env) {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    this.defaultModel = env.ANTHROPIC_DEFAULT_MODEL;
    this.maxTokens = env.ANTHROPIC_MAX_TOKENS;
    this.agentMaxTokens = env.AGENT_MAX_TOKENS;
    this.agentMaxTurns = env.AGENT_MAX_TURNS;
  }

  // ─── Simple chat (no tools) ──────────────────────────────────

  async streamChat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    callbacks: StreamCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal }
  ) {
    const model = options?.model || this.defaultModel;

    try {
      const stream = this.client.messages.stream({
        model,
        max_tokens: this.maxTokens,
        system: CHAT_SYSTEM_PROMPT,
        messages,
      });

      let fullText = "";

      for await (const event of stream) {
        if (options?.abortSignal?.aborted) { stream.abort(); break; }
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          fullText += event.delta.text;
          callbacks.onDelta(event.delta.text);
        }
      }

      const final = await stream.finalMessage();
      const costUsd = this.calculateCost(model, final.usage.input_tokens, final.usage.output_tokens);

      callbacks.onEnd({
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        costUsd,
        fullText,
      });
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  // ─── Agent loop (with tools) ─────────────────────────────────

  async runAgentLoop(
    conversationMessages: Anthropic.MessageParam[],
    callbacks: AgentCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal; budgetRemainingUsd?: number; agentType?: string }
  ): Promise<AgentResult> {
    const model = options?.model || this.defaultModel;
    const systemPrompt = options?.agentType === "qa" ? QA_SYSTEM_PROMPT
      : options?.agentType === "design" ? DESIGN_REVIEW_SYSTEM_PROMPT
      : AGENT_SYSTEM_PROMPT;

    const msgs: Anthropic.MessageParam[] = [...conversationMessages];
    const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0, turnCount: 0, toolCallCount: 0 };
    const allToolCalls: ToolCallSummary[] = [];
    let fullText = "";

    for (let turn = 1; turn <= this.agentMaxTurns; turn++) {
      if (options?.abortSignal?.aborted) break;
      if (options?.budgetRemainingUsd !== undefined && usage.costUsd >= options.budgetRemainingUsd) {
        callbacks.onError("Monthly AI budget exceeded.");
        break;
      }

      callbacks.onTurnStart(turn);
      usage.turnCount = turn;

      try {
        // ── Stream Claude's response ──
        const stream = this.client.messages.stream({
          model,
          max_tokens: this.agentMaxTokens,
          system: systemPrompt,
          tools: AGENT_TOOL_DEFINITIONS,
          messages: msgs,
        });

        let turnText = "";

        for await (const event of stream) {
          if (options?.abortSignal?.aborted) { stream.abort(); break; }

          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            turnText += event.delta.text;
            callbacks.onDelta(event.delta.text);
          }
        }

        const response = await stream.finalMessage();

        // Accumulate usage
        const turnCost = this.calculateCost(model, response.usage.input_tokens, response.usage.output_tokens);
        usage.inputTokens += response.usage.input_tokens;
        usage.outputTokens += response.usage.output_tokens;
        usage.costUsd += turnCost;
        fullText += turnText;

        // Collect tool_use blocks
        const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

        // ── No tools? Done. ──
        if (response.stop_reason === "end_turn" || toolBlocks.length === 0) {
          const result: AgentResult = { fullText, usage, toolCalls: allToolCalls };
          callbacks.onEnd(result);
          return result;
        }

        // ── Execute tools ──
        msgs.push({ role: "assistant", content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of toolBlocks) {
          if (options?.abortSignal?.aborted) break;

          const toolInput = block.input as Record<string, unknown>;
          const needsApproval = requiresApproval(block.name, toolInput);
          const t0 = Date.now();

          usage.toolCallCount++;

          const { result, isError } = await callbacks.onToolCall(
            block.id, block.name, toolInput, needsApproval
          );

          allToolCalls.push({
            toolCallId: block.id,
            toolName: block.name as ToolCallSummary["toolName"],
            input: toolInput,
            output: result,
            isError,
            durationMs: Date.now() - t0,
            approved: !needsApproval || !isError,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
            is_error: isError,
          });
        }

        msgs.push({ role: "user", content: toolResults });

      } catch (err) {
        callbacks.onError(err instanceof Error ? err.message : "Unknown error");
        break;
      }
    }

    if (usage.turnCount >= this.agentMaxTurns) {
      callbacks.onError(`Agent reached max turns (${this.agentMaxTurns}).`);
    }

    const result: AgentResult = { fullText, usage, toolCalls: allToolCalls };
    callbacks.onEnd(result);
    return result;
  }

  // ─── Helpers ─────────────────────────────────────────────────

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING["claude-sonnet-4-6"];
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  }
}
