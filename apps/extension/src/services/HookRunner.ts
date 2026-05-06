import * as vscode from "vscode";
import { spawn } from "node:child_process";
import type { HookEntry, AilancersSettings } from "@ailancers/shared-types";
import { parsePermissionRule, specifierMatches } from "@ailancers/shared-types";

/**
 * Outcome of a single hook execution. Mirrors Claude Code's stdout-JSON shape.
 *
 *   • `permissionDecision` — `PreToolUse` only. Forces an allow / ask / deny
 *     regardless of the user's persisted permission rules. Highest priority.
 *   • `additionalContext` — text injected into the agent's view of the tool
 *     result. For `PreToolUse` this is sent to the model as a system note
 *     before the tool runs (e.g. linter pre-warnings). For `PostToolUse` it
 *     appends to the tool's result body (e.g. "secrets-scan found 0 leaks").
 *   • `block` — `PreToolUse` only. Exit code 2 short-circuits with this stderr
 *     as the reason; the tool never runs.
 */
export interface HookOutcome {
  permissionDecision?: "allow" | "ask" | "deny";
  additionalContext?: string;
  block?: { reason: string };
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_HOOK_OUTPUT = 64 * 1024; // 64KB cap on stdout/stderr

export class HookRunner {
  constructor(private outputChannel?: vscode.OutputChannel) {}

  private log(msg: string): void {
    this.outputChannel?.appendLine(`[hooks] ${msg}`);
  }

  /**
   * Run all `PreToolUse` hooks matching the tool. Outcomes are merged with
   * Claude Code's precedence rule: `deny > ask > allow`. `additionalContext`
   * strings are concatenated.
   */
  async runPreToolUse(
    settings: AilancersSettings | null,
    toolName: string,
    toolInput: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<HookOutcome> {
    const hooks = matchingHooks(settings?.hooks?.PreToolUse, toolName, toolInput);
    if (hooks.length === 0) return {};

    const outcomes: HookOutcome[] = [];
    for (const hook of hooks) {
      if (abortSignal?.aborted) break;
      const result = await this.runHook(hook, {
        event: "PreToolUse",
        toolName,
        toolInput,
      }, abortSignal, settings);
      if (result) outcomes.push(result);
    }
    return mergeOutcomes(outcomes);
  }

  /**
   * Fire `SessionStart` hooks once per chat session — wired to ChatService's
   * first agent message in a conversation. Cannot block tools (no tool yet),
   * but `additionalContext` is prepended to the first user turn so it ends
   * up visible to the model. Useful for dynamic context injection
   * (e.g. "the user is in branch <X>", "today's stand-up summary is ...").
   */
  async runSessionStart(
    settings: AilancersSettings | null,
    abortSignal?: AbortSignal,
  ): Promise<HookOutcome> {
    const list = settings?.hooks?.SessionStart;
    if (!list || list.length === 0) return {};
    const outcomes: HookOutcome[] = [];
    for (const hook of list) {
      if (abortSignal?.aborted) break;
      // Session-level hooks have no `matcher` / `if` filtering — they run
      // unconditionally. The same shell + JSON-stdin contract still applies.
      const result = await this.runHook(hook, { event: "SessionStart" }, abortSignal, settings);
      if (result) {
        outcomes.push({ additionalContext: result.additionalContext });
      }
    }
    return mergeOutcomes(outcomes);
  }

  /**
   * Fire `UserPromptSubmit` hooks for each user message before the model
   * sees it. The hook receives the raw prompt text via stdin JSON; it can
   * return `additionalContext` (prepended to the prompt the model sees) or
   * exit 2 to block the message entirely. No tool is involved here, so the
   * `permissionDecision` field is ignored by the consumer.
   */
  async runUserPromptSubmit(
    settings: AilancersSettings | null,
    prompt: string,
    abortSignal?: AbortSignal,
  ): Promise<HookOutcome> {
    const list = settings?.hooks?.UserPromptSubmit;
    if (!list || list.length === 0) return {};
    const outcomes: HookOutcome[] = [];
    for (const hook of list) {
      if (abortSignal?.aborted) break;
      const result = await this.runHook(
        hook,
        { event: "UserPromptSubmit", prompt },
        abortSignal,
        settings,
      );
      if (result) outcomes.push(result);
    }
    // Re-use the standard merge — block + additionalContext both flow through.
    // permissionDecision is meaningless here so we strip it.
    const merged = mergeOutcomes(outcomes);
    delete merged.permissionDecision;
    return merged;
  }

  /**
   * Run all `PostToolUse` hooks matching the tool. PostToolUse cannot block
   * (the tool already ran), but can append `additionalContext` for the model
   * to see in the next turn.
   */
  async runPostToolUse(
    settings: AilancersSettings | null,
    toolName: string,
    toolInput: Record<string, unknown>,
    toolResult: { result: string; isError: boolean },
    abortSignal?: AbortSignal,
  ): Promise<HookOutcome> {
    const hooks = matchingHooks(settings?.hooks?.PostToolUse, toolName, toolInput);
    if (hooks.length === 0) return {};

    const outcomes: HookOutcome[] = [];
    for (const hook of hooks) {
      if (abortSignal?.aborted) break;
      const result = await this.runHook(hook, {
        event: "PostToolUse",
        toolName,
        toolInput,
        toolResult,
      }, abortSignal, settings);
      // PostToolUse cannot block — strip those fields if a hook tries to set them.
      if (result) {
        outcomes.push({
          additionalContext: result.additionalContext,
        });
      }
    }
    return mergeOutcomes(outcomes);
  }

  /**
   * HTTP hook execution. POSTs the JSON payload to `hook.url` and reads the
   * response body as the same `{ permissionDecision?, additionalContext? }`
   * shape as command-type hooks. The URL must match a prefix in the project's
   * `allowedHttpHookUrls` allowlist or the hook is refused — additive opt-in
   * to prevent a committed settings.json from silently exfiltrating data.
   *
   * Status code mapping:
   *   • 200-299    → parse body for outcome
   *   • 400-499    → log + treat as "no outcome" (hook accepted but said
   *                  nothing actionable)
   *   • 5xx + PreToolUse hooks → block, with body's first line as reason
   *   • timeout / network failure → log + return null (skip this hook)
   */
  private async runHttpHook(
    hook: HookEntry,
    payload: Record<string, unknown>,
    abortSignal?: AbortSignal,
    settings?: AilancersSettings | null,
  ): Promise<HookOutcome | null> {
    if (!hook.url) {
      this.log(`http hook missing 'url': ignoring`);
      return null;
    }
    const allow = settings?.allowedHttpHookUrls ?? [];
    const allowed = allow.some((prefix) => hook.url!.startsWith(prefix));
    if (!allowed) {
      this.log(
        `http hook to \`${hook.url}\` refused: not in 'allowedHttpHookUrls' allowlist. Add the URL prefix to enable.`,
      );
      return null;
    }
    const timeoutMs = (hook.timeout ?? 60) * 1000;
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(hook.headers ?? {}),
        },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      const body = await resp.text();
      if (resp.status >= 200 && resp.status < 300) {
        const parsed = tryParseHookStdout(body);
        return parsed ?? { additionalContext: body.trim() || undefined };
      }
      // 5xx on a PreToolUse-style hook = block.
      if (payload.event === "PreToolUse" && resp.status >= 500) {
        const reason = (body.trim().split("\n")[0] || `HTTP hook returned ${resp.status}`).slice(0, 240);
        return { block: { reason } };
      }
      this.log(`http hook \`${hook.url}\` returned ${resp.status}: ${body.slice(0, 200)}`);
      return null;
    } catch (err) {
      this.log(`http hook \`${hook.url}\` failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
    }
  }

  private async runHook(
    hook: HookEntry,
    payload: Record<string, unknown>,
    abortSignal?: AbortSignal,
    settings?: AilancersSettings | null,
  ): Promise<HookOutcome | null> {
    if (hook.type === "http") {
      return this.runHttpHook(hook, payload, abortSignal, settings ?? null);
    }
    if (!hook.command) {
      this.log(`hook missing command (and not type:"http"): ignoring`);
      return null;
    }
    const command = hook.command;
    const timeoutMs = (hook.timeout ?? 60) * 1000;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    return new Promise<HookOutcome | null>((resolve) => {
      let resolved = false;
      const finish = (out: HookOutcome | null) => {
        if (resolved) return;
        resolved = true;
        resolve(out);
      };

      // Spawn via the platform shell so users can write `./scripts/foo.sh` or
      // `npm run lint:hook` without worrying about exec semantics.
      const isWin = process.platform === "win32";
      const shell = isWin ? "cmd.exe" : "/bin/bash";
      const shellFlag = isWin ? "/c" : "-c";

      const child = spawn(shell, [shellFlag, command], {
        cwd,
        env: {
          ...process.env,
          AILANCERS_PROJECT_DIR: cwd,
          AILANCERS_HOOK_EVENT: String(payload.event ?? ""),
          AILANCERS_HOOK_TOOL: String(payload.toolName ?? ""),
        },
      });

      let stdout = "";
      let stderr = "";

      const onAbort = () => {
        try { child.kill("SIGTERM"); } catch { /* already dead */ }
      };
      if (abortSignal) {
        if (abortSignal.aborted) {
          try { child.kill("SIGTERM"); } catch { /* never started */ }
          finish(null);
          return;
        }
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      // Write the JSON payload then close stdin so commands like `cat | jq` work.
      try {
        child.stdin?.end(JSON.stringify(payload) + "\n");
      } catch (err) {
        this.log(`stdin write failed for hook \`${hook.command}\`: ${err instanceof Error ? err.message : err}`);
      }

      child.stdout?.on("data", (chunk) => {
        if (stdout.length < MAX_HOOK_OUTPUT) stdout += chunk.toString("utf-8");
      });
      child.stderr?.on("data", (chunk) => {
        if (stderr.length < MAX_HOOK_OUTPUT) stderr += chunk.toString("utf-8");
      });

      const timer = setTimeout(() => {
        this.log(`hook timed out after ${hook.timeout ?? 60}s: \`${hook.command}\``);
        try { child.kill("SIGTERM"); } catch { /* */ }
      }, timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        abortSignal?.removeEventListener("abort", onAbort);
        this.log(`hook spawn failed: \`${hook.command}\`: ${err.message}`);
        finish(null);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        abortSignal?.removeEventListener("abort", onAbort);

        // Exit-code 2 = blocking (PreToolUse only). The merger drops the
        // block on a PostToolUse hook by ignoring the field.
        if (code === 2) {
          const reason = stderr.trim().split("\n")[0] || "Hook blocked the action.";
          finish({ block: { reason } });
          return;
        }

        // Non-zero non-2 = warn but don't block. Fall through to JSON parse.
        if (code !== 0 && code !== null) {
          const firstLine = stderr.trim().split("\n")[0] || `Hook exited ${code}`;
          this.log(`hook \`${hook.command}\` exited ${code}: ${firstLine}`);
        }

        // Parse stdout for the JSON return shape. Tolerate non-JSON stdout —
        // many hooks just print logs.
        const parsed = tryParseHookStdout(stdout);
        if (parsed) finish(parsed);
        else finish({ additionalContext: stdout.trim() || undefined });
      });
    });
  }
}

/** Filter hooks by the `matcher` and `if` fields. */
function matchingHooks(
  list: readonly HookEntry[] | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
): HookEntry[] {
  if (!list || list.length === 0) return [];
  return list.filter((h) => {
    if (h.matcher) {
      // matcher is exact name OR `|`-separated alternation OR JS regex string
      const m = h.matcher;
      if (m.startsWith("/") && m.endsWith("/")) {
        try { if (!new RegExp(m.slice(1, -1)).test(toolName)) return false; } catch { return false; }
      } else if (m.includes("|")) {
        if (!m.split("|").map((s) => s.trim()).includes(toolName)) return false;
      } else if (m !== toolName) {
        return false;
      }
    }
    if (h.if) {
      const rule = parsePermissionRule(h.if);
      if (!rule) return false;
      // Map our internal tool names to the rule grammar's labels (same map
      // PermissionEvaluator uses). For the simpler check here we just compare
      // the rule's tool name directly against a small subset.
      const candidate = candidateForTool(toolName, toolInput);
      if (candidate === null) return false;
      // Tool-grammar label match against the internal name, lenient on case
      const expectedTools: Record<string, string[]> = {
        Bash: ["run_terminal"],
        Read: ["read_file"],
        Edit: ["edit_file"],
        Write: ["write_file"],
        Grep: ["search_files"],
        List: ["list_directory"],
        Glob: ["glob_files"],
      };
      const ok = expectedTools[rule.tool]?.includes(toolName) ?? rule.tool === toolName;
      if (!ok) return false;
      if (!specifierMatches(rule.specifier, candidate)) return false;
    }
    return true;
  });
}

function candidateForTool(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === "run_terminal" && typeof input.command === "string") return input.command.trim();
  if (typeof input.path === "string") return input.path;
  return null;
}

/** Combine multiple outcomes per Claude Code precedence: `deny > ask > allow`,
 *  `additionalContext` concatenated. Block on first hook that exits 2. */
function mergeOutcomes(outcomes: HookOutcome[]): HookOutcome {
  const merged: HookOutcome = {};
  const decisions: ("allow" | "ask" | "deny")[] = [];
  const ctx: string[] = [];

  for (const o of outcomes) {
    if (o.block) {
      // First block wins, short-circuits everything else.
      return { block: o.block };
    }
    if (o.permissionDecision) decisions.push(o.permissionDecision);
    if (o.additionalContext) ctx.push(o.additionalContext);
  }

  if (decisions.includes("deny")) merged.permissionDecision = "deny";
  else if (decisions.includes("ask")) merged.permissionDecision = "ask";
  else if (decisions.includes("allow")) merged.permissionDecision = "allow";

  if (ctx.length > 0) merged.additionalContext = ctx.join("\n\n");
  return merged;
}

function tryParseHookStdout(stdout: string): HookOutcome | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const obj = JSON.parse(trimmed) as {
      permissionDecision?: string;
      additionalContext?: string;
    };
    const out: HookOutcome = {};
    if (
      obj.permissionDecision === "allow" ||
      obj.permissionDecision === "ask" ||
      obj.permissionDecision === "deny"
    ) {
      out.permissionDecision = obj.permissionDecision;
    }
    if (typeof obj.additionalContext === "string" && obj.additionalContext.trim()) {
      out.additionalContext = obj.additionalContext.trim();
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

