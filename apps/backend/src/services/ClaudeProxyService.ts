import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../config/env.js";
import { AGENT_TOOL_DEFINITIONS, AGENT_SYSTEM_PROMPT, QA_SYSTEM_PROMPT, DESIGN_REVIEW_SYSTEM_PROMPT, PLANNING_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT, requiresApproval } from "./agentTools.js";
import type { AgentUsage, ToolCallSummary } from "@ailancers/shared-types";

// Pricing per million tokens (as of Feb 2026)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onEnd: (result: { inputTokens: number; outputTokens: number; costUsd: number; fullText: string }) => void;
  onError: (error: string) => void;
}

export interface AgentCallbacks {
  onDelta: (text: string) => void;
  onToolCall: (toolCallId: string, toolName: string, toolInput: Record<string, unknown>, needsApproval: boolean) => Promise<{ result: string; isError: boolean }>;
  onTurnStart: (turnNumber: number) => void;
  onEnd: (result: AgentResult) => void;
  onError: (error: string) => void;
}

export interface AgentResult {
  fullText: string;
  usage: AgentUsage;
  toolCalls: ToolCallSummary[];
}

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

  async streamChat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    callbacks: StreamCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal }
  ) {
    const model = options?.model || this.defaultModel;
    const startTime = Date.now();

    try {
      const stream = this.client.messages.stream({
        model,
        max_tokens: this.maxTokens,
        system: CHAT_SYSTEM_PROMPT,
        messages,
      });

      let fullText = "";

      for await (const event of stream) {
        if (options?.abortSignal?.aborted) {
          stream.abort();
          break;
        }

        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          fullText += event.delta.text;
          callbacks.onDelta(event.delta.text);
        }
      }

      const finalMessage = await stream.finalMessage();
      const inputTokens = finalMessage.usage.input_tokens;
      const outputTokens = finalMessage.usage.output_tokens;
      const costUsd = this.calculateCost(model, inputTokens, outputTokens);

      callbacks.onEnd({
        inputTokens,
        outputTokens,
        costUsd,
        fullText,
      });

      return { inputTokens, outputTokens, costUsd, latencyMs: Date.now() - startTime };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      callbacks.onError(message);
      throw err;
    }
  }

  /**
   * Run the agentic loop: Claude calls tools, we execute them, feed results back, repeat.
   * The loop continues until Claude produces a final text response (stop_reason=end_turn)
   * or we exceed budget/turn limits.
   */
  async runAgentLoop(
    conversationMessages: Anthropic.MessageParam[],
    callbacks: AgentCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal; budgetRemainingUsd?: number; agentType?: string }
  ): Promise<AgentResult> {
    const model = options?.model || this.defaultModel;
    const systemPrompt = options?.agentType === "qa" ? QA_SYSTEM_PROMPT
      : options?.agentType === "design" ? DESIGN_REVIEW_SYSTEM_PROMPT
      : options?.agentType === "planning" ? PLANNING_SYSTEM_PROMPT
      : AGENT_SYSTEM_PROMPT;
    const msgs: Anthropic.MessageParam[] = [...conversationMessages];

    const totalUsage: AgentUsage = {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      turnCount: 0,
      toolCallCount: 0,
    };
    const allToolCalls: ToolCallSummary[] = [];
    let fullText = "";

    for (let turn = 1; turn <= this.agentMaxTurns; turn++) {
      if (options?.abortSignal?.aborted) break;

      // Budget check
      if (options?.budgetRemainingUsd !== undefined && totalUsage.costUsd >= options.budgetRemainingUsd) {
        callbacks.onError("Monthly AI budget exceeded. Contact your team admin.");
        break;
      }

      callbacks.onTurnStart(turn);
      totalUsage.turnCount = turn;

      try {
        const response = await this.client.messages.create({
          model,
          max_tokens: this.agentMaxTokens,
          system: systemPrompt,
          tools: AGENT_TOOL_DEFINITIONS,
          messages: msgs,
        });

        // Accumulate token usage
        const turnInput = response.usage.input_tokens;
        const turnOutput = response.usage.output_tokens;
        const turnCost = this.calculateCost(model, turnInput, turnOutput);
        totalUsage.inputTokens += turnInput;
        totalUsage.outputTokens += turnOutput;
        totalUsage.costUsd += turnCost;

        // Process content blocks: stream text, collect tool_use blocks
        const toolUseBlocks: Anthropic.ContentBlock[] = [];
        let turnText = "";

        for (const block of response.content) {
          if (block.type === "text") {
            turnText += block.text;
            callbacks.onDelta(block.text);
          } else if (block.type === "tool_use") {
            toolUseBlocks.push(block);
          }
        }

        fullText += turnText;

        // If Claude is done (no tool calls), we're finished
        if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
          const result: AgentResult = { fullText, usage: totalUsage, toolCalls: allToolCalls };
          callbacks.onEnd(result);
          return result;
        }

        // Claude wants to use tools — execute them
        // Add assistant message with all content blocks to conversation
        msgs.push({ role: "assistant", content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of toolUseBlocks) {
          if (block.type !== "tool_use") continue;
          if (options?.abortSignal?.aborted) break;

          const toolInput = block.input as Record<string, unknown>;
          const needsApproval = requiresApproval(block.name, toolInput);
          const startTime = Date.now();

          totalUsage.toolCallCount++;

          // Ask the extension to execute the tool (this goes over WebSocket)
          const { result, isError } = await callbacks.onToolCall(
            block.id,
            block.name,
            toolInput,
            needsApproval
          );

          const summary: ToolCallSummary = {
            toolCallId: block.id,
            toolName: block.name as ToolCallSummary["toolName"],
            input: toolInput,
            output: result,
            isError,
            durationMs: Date.now() - startTime,
            approved: !needsApproval || !isError,
          };
          allToolCalls.push(summary);

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
            is_error: isError,
          });
        }

        // Add tool results to conversation for next Claude turn
        msgs.push({ role: "user", content: toolResults });

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        callbacks.onError(message);
        const result: AgentResult = { fullText, usage: totalUsage, toolCalls: allToolCalls };
        return result;
      }
    }

    // If we hit max turns
    if (totalUsage.turnCount >= this.agentMaxTurns) {
      callbacks.onError(`Agent reached maximum turn limit (${this.agentMaxTurns}). Stopping.`);
    }

    const result: AgentResult = { fullText, usage: totalUsage, toolCalls: allToolCalls };
    callbacks.onEnd(result);
    return result;
  }

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING["claude-sonnet-4-6"];
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  }
}
