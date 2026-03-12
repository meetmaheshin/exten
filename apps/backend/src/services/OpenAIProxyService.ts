import OpenAI from "openai";
import type { Env } from "../config/env.js";
import { AGENT_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT, requiresApproval } from "./agentTools.js";
import type { AgentUsage, ToolCallSummary } from "@ailancers/shared-types";
import type { StreamCallbacks, AgentCallbacks, AgentResult } from "./ClaudeProxyService.js";

// Pricing per million tokens (as of Mar 2026)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "o4-mini": { input: 1.1, output: 4.4 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "codex-mini-latest": { input: 1.5, output: 6.0 },
};

// Convert our Anthropic tool definitions to OpenAI format
const OPENAI_TOOL_DEFINITIONS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file at the given path. Returns file content as text with line numbers.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from workspace root" },
          offset: { type: "number", description: "Line number to start reading from (1-based). Optional." },
          limit: { type: "number", description: "Maximum number of lines to read. Defaults to 2000." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create a new file or completely overwrite an existing file with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from workspace root" },
          content: { type: "string", description: "The complete file content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Make a surgical edit to a file by replacing a specific string with new content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from workspace root" },
          old_text: { type: "string", description: "The exact text to find and replace" },
          new_text: { type: "string", description: "The replacement text" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_terminal",
      description: "Execute a shell command and return its stdout/stderr output.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute" },
          cwd: { type: "string", description: "Working directory relative to workspace root. Optional." },
          timeout_ms: { type: "number", description: "Timeout in milliseconds. Defaults to 30000." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a regex pattern across files in the workspace.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Directory to search in. Optional." },
          include_glob: { type: "string", description: "Glob pattern to filter files. Optional." },
          max_results: { type: "number", description: "Max matching lines. Defaults to 100." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and directories at the given path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path. Defaults to '.'." },
          recursive: { type: "boolean", description: "List recursively. Defaults to false." },
          max_depth: { type: "number", description: "Max recursion depth. Defaults to 3." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob_files",
      description: "Find files matching a glob pattern in the workspace.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts')" },
          path: { type: "string", description: "Base directory. Optional." },
        },
        required: ["pattern"],
      },
    },
  },
];

/** Check if a model uses the Responses API instead of Chat Completions */
function isResponsesApiModel(model: string): boolean {
  return model.includes("codex") || model.startsWith("gpt-5");
}

export class OpenAIProxyService {
  private client: OpenAI;
  private defaultModel: string;
  private codingModel: string;
  private maxTokens: number;
  private agentMaxTokens: number;
  private agentMaxTurns: number;

  constructor(env: Env) {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    this.defaultModel = env.OPENAI_DEFAULT_MODEL;
    this.codingModel = env.OPENAI_CODING_MODEL || "";
    this.maxTokens = env.OPENAI_MAX_TOKENS;
    this.agentMaxTokens = env.AGENT_MAX_TOKENS;
    this.agentMaxTurns = env.AGENT_MAX_TURNS;
  }

  /** Get the coding model (for agent mode) — falls back to default if not set */
  getCodingModel(): string {
    return this.codingModel || this.defaultModel;
  }

  async streamChat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    callbacks: StreamCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal }
  ) {
    const model = options?.model || this.defaultModel;
    const startTime = Date.now();

    try {
      // Use Responses API for codex/gpt-5 models
      if (isResponsesApiModel(model)) {
        return await this.streamChatResponses(model, messages, callbacks, options);
      }

      const stream = await this.client.chat.completions.create({
        model,
        max_tokens: this.maxTokens,
        messages: [
          { role: "system", content: CHAT_SYSTEM_PROMPT },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        stream: true,
      });

      let fullText = "";

      for await (const chunk of stream) {
        if (options?.abortSignal?.aborted) break;

        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          callbacks.onDelta(delta);
        }
      }

      // OpenAI streaming doesn't give exact token counts in stream — estimate
      const inputTokens = Math.ceil(messages.reduce((acc, m) => acc + m.content.length, 0) / 4);
      const outputTokens = Math.ceil(fullText.length / 4);
      const costUsd = this.calculateCost(model, inputTokens, outputTokens);

      callbacks.onEnd({ inputTokens, outputTokens, costUsd, fullText });

      return { inputTokens, outputTokens, costUsd, latencyMs: Date.now() - startTime };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      callbacks.onError(message);
      throw err;
    }
  }

  /** Stream chat using OpenAI Responses API (for codex/gpt-5 models) */
  private async streamChatResponses(
    model: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    callbacks: StreamCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal }
  ) {
    const startTime = Date.now();

    try {
      // Build input from conversation history
      const input = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const stream = await this.client.responses.create({
        model,
        instructions: CHAT_SYSTEM_PROMPT,
        input,
        stream: true,
      });

      let fullText = "";

      for await (const event of stream) {
        if (options?.abortSignal?.aborted) break;

        if (event.type === "response.output_text.delta") {
          const delta = (event as { delta?: string }).delta;
          if (delta) {
            fullText += delta;
            callbacks.onDelta(delta);
          }
        }
      }

      const inputTokens = Math.ceil(messages.reduce((acc, m) => acc + m.content.length, 0) / 4);
      const outputTokens = Math.ceil(fullText.length / 4);
      const costUsd = this.calculateCost(model, inputTokens, outputTokens);

      callbacks.onEnd({ inputTokens, outputTokens, costUsd, fullText });

      return { inputTokens, outputTokens, costUsd, latencyMs: Date.now() - startTime };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      callbacks.onError(message);
      throw err;
    }
  }

  async runAgentLoop(
    conversationMessages: Array<{ role: string; content: string }>,
    callbacks: AgentCallbacks,
    options?: { model?: string; abortSignal?: AbortSignal; budgetRemainingUsd?: number }
  ): Promise<AgentResult> {
    // For agent/coding mode, prefer the dedicated coding model
    const model = this.codingModel || options?.model || this.defaultModel;

    const msgs: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      ...conversationMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

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

      if (options?.budgetRemainingUsd !== undefined && totalUsage.costUsd >= options.budgetRemainingUsd) {
        callbacks.onError("Monthly AI budget exceeded. Contact your team admin.");
        break;
      }

      callbacks.onTurnStart(turn);
      totalUsage.turnCount = turn;

      try {
        const response = await this.client.chat.completions.create({
          model,
          max_tokens: this.agentMaxTokens,
          messages: msgs,
          tools: OPENAI_TOOL_DEFINITIONS,
          tool_choice: "auto",
        });

        const choice = response.choices[0];
        const message = choice.message;

        // Accumulate usage
        const turnInput = response.usage?.prompt_tokens ?? 0;
        const turnOutput = response.usage?.completion_tokens ?? 0;
        const turnCost = this.calculateCost(model, turnInput, turnOutput);
        totalUsage.inputTokens += turnInput;
        totalUsage.outputTokens += turnOutput;
        totalUsage.costUsd += turnCost;

        // Handle text content
        if (message.content) {
          fullText += message.content;
          callbacks.onDelta(message.content);
        }

        // If no tool calls, we're done
        if (!message.tool_calls || message.tool_calls.length === 0) {
          const result: AgentResult = { fullText, usage: totalUsage, toolCalls: allToolCalls };
          callbacks.onEnd(result);
          return result;
        }

        // Add assistant message to history
        msgs.push(message);

        // Execute tool calls
        for (const toolCall of message.tool_calls) {
          if (options?.abortSignal?.aborted) break;
          if (toolCall.type !== "function") continue;

          const toolName = toolCall.function.name;
          let toolInput: Record<string, unknown> = {};
          try {
            toolInput = JSON.parse(toolCall.function.arguments);
          } catch {
            toolInput = { raw: toolCall.function.arguments };
          }

          const needsApproval = requiresApproval(toolName, toolInput);
          const startTime = Date.now();
          totalUsage.toolCallCount++;

          const { result, isError } = await callbacks.onToolCall(
            toolCall.id,
            toolName,
            toolInput,
            needsApproval
          );

          const summary: ToolCallSummary = {
            toolCallId: toolCall.id,
            toolName: toolName as ToolCallSummary["toolName"],
            input: toolInput,
            output: result,
            isError,
            durationMs: Date.now() - startTime,
            approved: !needsApproval || !isError,
          };
          allToolCalls.push(summary);

          // Add tool result to messages
          msgs.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        callbacks.onError(message);
        return { fullText, usage: totalUsage, toolCalls: allToolCalls };
      }
    }

    if (totalUsage.turnCount >= this.agentMaxTurns) {
      callbacks.onError(`Agent reached maximum turn limit (${this.agentMaxTurns}). Stopping.`);
    }

    const result: AgentResult = { fullText, usage: totalUsage, toolCalls: allToolCalls };
    callbacks.onEnd(result);
    return result;
  }

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING["gpt-4o"];
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  }
}
