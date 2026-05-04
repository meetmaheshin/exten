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
    options?: { model?: string; abortSignal?: AbortSignal; budgetRemainingUsd?: number; agentType?: string; projectRules?: string; planMode?: boolean }
  ): Promise<AgentResult> {
    const model = options?.model || this.defaultModel;
    let systemPrompt = options?.agentType === "qa" ? QA_SYSTEM_PROMPT
      : options?.agentType === "design" ? DESIGN_REVIEW_SYSTEM_PROMPT
      : AGENT_SYSTEM_PROMPT;

    // Plan mode: append a strict instruction so the model proposes before acting.
    // We also strip write-tools from the tool list below.
    if (options?.planMode) {
      systemPrompt += "\n\n<plan_mode>\nYou are in PLAN MODE. You can read files, search, list directories, and run inspection-only commands — but you MUST NOT write files, edit files, or run commands that modify state. Instead, finish with a clear, numbered plan of the changes you propose. The user will review and turn off plan mode to execute it.\n</plan_mode>";
    }

    // Project rules (CLAUDE.md-equivalent): prepend so the model treats them as
    // context, not instructions to override the agent system prompt.
    if (options?.projectRules && options.projectRules.trim().length > 0) {
      systemPrompt += `\n\n<project_rules>\nThe following rules come from the project's .ailancers/instructions.md file. Follow them unless the user explicitly asks otherwise.\n\n${options.projectRules.trim()}\n</project_rules>`;
    }

    // In plan mode, narrow tool set to read-only ones. Names match agentTools.ts.
    const READ_ONLY_TOOLS = new Set(["read_file", "search_files", "list_directory", "glob_files", "find_symbol", "figma_read"]);
    const activeTools = options?.planMode
      ? AGENT_TOOL_DEFINITIONS.filter((t) => READ_ONLY_TOOLS.has(t.name))
      : AGENT_TOOL_DEFINITIONS;

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
          tools: activeTools,
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

          // spawn_subagent runs server-side: nested agent loop with read-only
          // tools, returns a single string summary. The extension never sees
          // the sub-agent's individual tool calls — keeps the user's UI clean.
          let result: string;
          let isError: boolean;
          if (block.name === "spawn_subagent") {
            const sub = await this.runSubAgent(
              (toolInput.task as string) || "",
              callbacks,
              { ...options, parentMsgs: msgs, parentTurn: turn }
            );
            result = sub.result;
            isError = sub.isError;
            // Roll the sub-agent's token cost into the parent's tally
            usage.inputTokens += sub.inputTokens;
            usage.outputTokens += sub.outputTokens;
            usage.costUsd += sub.costUsd;
          } else {
            const r = await callbacks.onToolCall(block.id, block.name, toolInput, needsApproval);
            result = r.result;
            isError = r.isError;
          }

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

  // ─── Sub-agent ───────────────────────────────────────────────
  /**
   * Run a focused research sub-agent in its own context window. Read-only
   * tools, capped turns, returns a single string summary that the parent
   * receives as its tool_result. Token cost is rolled into the parent's tally.
   *
   * The parent's `callbacks.onToolCall` is reused for read-only tools so the
   * extension still executes them — the sub-agent doesn't bypass the user's
   * machine. Approval is auto-allowed since these are all read tools.
   */
  private async runSubAgent(
    task: string,
    parentCallbacks: AgentCallbacks,
    options: { model?: string; abortSignal?: AbortSignal; parentMsgs?: Anthropic.MessageParam[]; parentTurn?: number }
  ): Promise<{ result: string; isError: boolean; inputTokens: number; outputTokens: number; costUsd: number }> {
    const SUB_AGENT_MAX_TURNS = 8;
    const READ_ONLY_TOOLS = new Set(["read_file", "search_files", "list_directory", "glob_files", "find_symbol", "figma_read"]);
    const subTools = AGENT_TOOL_DEFINITIONS.filter((t) => READ_ONLY_TOOLS.has(t.name));

    const subSystem = `You are a focused research sub-agent. Your job is to investigate the codebase and answer a single, well-defined question for the parent agent.

Rules:
- You have read-only tools only. You CANNOT write, edit, or run shell commands.
- Be efficient. The parent agent's context is precious — return a tight, well-organized summary, not a transcript.
- Cite file paths with line numbers (file:line) when referring to specific code.
- If the question is too vague to answer well, say so and ask the parent to refine it.
- Finish with a clear answer or summary. Do NOT continue exploring once you have enough.`;

    const subMsgs: Anthropic.MessageParam[] = [{ role: "user", content: task }];
    let subInput = 0;
    let subOutput = 0;
    let subFullText = "";

    for (let turn = 1; turn <= SUB_AGENT_MAX_TURNS; turn++) {
      if (options.abortSignal?.aborted) break;

      try {
        const stream = this.client.messages.stream({
          model: options.model || this.defaultModel,
          max_tokens: this.agentMaxTokens,
          system: subSystem,
          tools: subTools,
          messages: subMsgs,
        });

        let turnText = "";
        for await (const event of stream) {
          if (options.abortSignal?.aborted) { stream.abort(); break; }
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            turnText += event.delta.text;
          }
        }

        const response = await stream.finalMessage();
        subInput += response.usage.input_tokens;
        subOutput += response.usage.output_tokens;
        subFullText += turnText;

        const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (response.stop_reason === "end_turn" || toolBlocks.length === 0) break;

        subMsgs.push({ role: "assistant", content: response.content });
        const subResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolBlocks) {
          if (!READ_ONLY_TOOLS.has(block.name)) {
            subResults.push({ type: "tool_result", tool_use_id: block.id, content: `Tool '${block.name}' is not available to sub-agents (read-only).`, is_error: true });
            continue;
          }
          // Reuse the parent's onToolCall — extension executes the tool, no approval needed for reads
          const r = await parentCallbacks.onToolCall(block.id, block.name, block.input as Record<string, unknown>, false);
          subResults.push({ type: "tool_result", tool_use_id: block.id, content: r.result, is_error: r.isError });
        }
        subMsgs.push({ role: "user", content: subResults });
      } catch (err) {
        return {
          result: `Sub-agent failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
          inputTokens: subInput,
          outputTokens: subOutput,
          costUsd: this.calculateCost(options.model || this.defaultModel, subInput, subOutput),
        };
      }
    }

    return {
      result: subFullText.trim() || "(sub-agent returned no answer)",
      isError: false,
      inputTokens: subInput,
      outputTokens: subOutput,
      costUsd: this.calculateCost(options.model || this.defaultModel, subInput, subOutput),
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING["claude-sonnet-4-6"];
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  }
}
