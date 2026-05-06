/**
 * `.ailancers/settings.json` schema — shared between the extension host and
 * (eventually) the backend.
 *
 * Loader precedence (highest first):
 *   1. `.ailancers/settings.local.json` — gitignored personal overrides
 *   2. `.ailancers/settings.json`       — team-shared, checked in
 *   3. `~/.ailancers/settings.json`     — user-level, all projects
 *
 * Merge semantics:
 *   • Scalars: higher scope wins.
 *   • Arrays inside `permissions.{allow,deny,ask}`: cumulative (union, deduped).
 *     This matches Claude Code's `Tool(specifier)` behavior — adding a project
 *     allow doesn't replace your user-level allows.
 *   • Objects (e.g. `mcpServers`): merged by key; higher scope wins on conflict.
 *
 * v1 status: `permissions` and `model` are wired in. The other top-level keys
 * (`hooks`, `mcpServers`, `agents`, `rules`, `env`) are reserved here so users
 * who write the file today don't have to migrate later.
 */
export interface AilancersSettings {
  /** JSON Schema URL — purely for editor autocomplete. Loader ignores it. */
  $schema?: string;

  /** Default model id when starting a new conversation (e.g. "claude-sonnet-4-6"). */
  model?: string;

  /**
   * Permission rules using Claude Code's `Tool(specifier)` syntax.
   *
   * RESERVED TOOL NAMESPACES (forward-compatibility — write rules using these
   * names today and they'll work without modification when the relevant
   * features ship):
   *
   *   - `mcp__<server>` and `mcp__<server>__<tool>` — MCP-provided tools.
   *     Once the MCP client lands, `Bash(mcp__github__create_issue)` etc.
   *     become valid rule targets.
   *   - `Agent(<agent-name>)` — subagent invocations, when the subagent
   *     system lands.
   *   - `Hook(<hook-id>)` — hook fire events, for hooks v2+.
   */
  permissions?: {
    /**
     * Patterns that auto-approve when matched. Examples:
     *   - "Bash(npm test)"            — exact command
     *   - "Bash(npm run *)"           — leading-prefix
     *   - "Bash(git status:*)"        — `:*` matches a trailing `*` arg
     *   - "Read"                      — blanket allow
     *   - "Read(./src/**)"            — root-relative path glob
     */
    allow?: string[];
    /**
     * Patterns that always block, even if a more permissive `allow` exists.
     * Evaluated FIRST. Examples: `"Edit(.env*)"`, `"Bash(curl *)"`.
     */
    deny?: string[];
    /**
     * Patterns that force a user prompt (overrides any `allow`). Useful for
     * "auto-approve all bash, but always ask before `git push`".
     */
    ask?: string[];
  };

  /**
   * Reserved for hooks v1 (PreToolUse / PostToolUse). Accepted by the schema
   * but currently unconsumed — loader logs a one-line note.
   */
  hooks?: {
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
    UserPromptSubmit?: HookEntry[];
    SessionStart?: HookEntry[];
    SessionEnd?: HookEntry[];
  };

  /** Allowlist of URL prefixes hooks with `type: "http"` may POST to.
   *  Without this list every HTTP hook is refused — additive opt-in to
   *  prevent a project committing a settings.json that exfiltrates tool
   *  inputs. Match is prefix-based (case-sensitive). Example:
   *    `["https://hooks.example.com/", "https://internal.corp/lint"]`. */
  allowedHttpHookUrls?: string[];

  /**
   * Reserved for MCP-server configuration. Accepted by the schema but
   * currently unconsumed — once the MCP client lands the loader will hand
   * this map to it.
   */
  mcpServers?: Record<string, McpServerConfig>;

  /** Reserved for subagent registration; unconsumed today. */
  agents?: AgentConfig[];

  /** Reserved for path-scoped rules; unconsumed today. */
  rules?: RuleConfig[];

  /** Environment variables passed to local tool executions (e.g. `run_terminal`). */
  env?: Record<string, string>;
}

export interface HookEntry {
  /** Tool-name matcher: exact name, `|`-separated alternation, or regex string. */
  matcher?: string;
  /** Optional permission-rule-syntax filter, e.g. `"Bash(git *)"`. */
  if?: string;
  /** Execution type. Defaults to `"command"` for backward compat — older
   *  configs with just `command:` keep working. `"http"` POSTs the JSON
   *  payload to `url` and reads the same JSON response shape from the body. */
  type?: "command" | "http";
  /** Shell command to run. Receives JSON on stdin, exits 0/2 on success/block.
   *  Required when `type` is omitted or `"command"`. */
  command?: string;
  /** HTTP endpoint to POST the JSON payload to. Required when `type === "http"`.
   *  Must appear in the project's `allowedHttpHookUrls` allowlist. Response
   *  body is parsed as the same `{ permissionDecision?, additionalContext? }`
   *  shape as command-type hooks. HTTP 500-class responses are treated as
   *  exit-2 (blocking) for PreToolUse hooks. */
  url?: string;
  /** Optional headers for HTTP hooks (e.g. auth tokens). */
  headers?: Record<string, string>;
  /** Per-hook timeout in seconds; default 60. */
  timeout?: number;
  /** Custom spinner text shown while the hook runs. */
  statusMessage?: string;
}

export interface McpServerConfig {
  type?: "stdio" | "http";
  /** For stdio: executable to spawn. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** For http: server URL. */
  url?: string;
  headers?: Record<string, string>;
}

export interface AgentConfig {
  name: string;
  description?: string;
  systemPrompt?: string;
  /** Tool allowlist. If absent, the agent inherits all tools. */
  tools?: string[];
  /** Optional model override (`sonnet`, `opus`, `haiku`, or full id). */
  model?: string;
}

export interface RuleConfig {
  /** Markdown file path (relative to .ailancers/) holding the rule body. */
  file: string;
  /** Globs that, when read by the agent, trigger loading this rule. */
  paths?: string[];
}

/**
 * Parsed `Tool(specifier)` rule from `permissions.{allow,deny,ask}`.
 */
export interface PermissionRule {
  /** Tool name — `Bash`, `Read`, `Edit`, etc. Case-sensitive in our impl. */
  tool: string;
  /** Specifier inside the parens, or undefined for a blanket rule. */
  specifier?: string;
}

/** Tiny parser used by the host loader. */
export function parsePermissionRule(raw: string): PermissionRule | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Match: `Tool` or `Tool(specifier)` (no nested parens supported)
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/.exec(trimmed);
  if (!m) return null;
  return { tool: m[1], specifier: m[2] };
}

/**
 * Match a glob-ish specifier against a candidate string. Supports:
 *   • `*` — match any chars except `/`
 *   • `**` — match anything (incl. `/`)
 *   • `:*` — trailing args after a literal command
 *   • exact match otherwise
 */
export function specifierMatches(specifier: string | undefined, candidate: string): boolean {
  if (specifier === undefined) return true; // blanket rule
  if (specifier === candidate) return true;

  // `:*` — claude-code-style trailing-args rule, e.g. `Bash(npm run :*)`
  if (specifier.endsWith(":*")) {
    const head = specifier.slice(0, -2);
    return candidate === head || candidate.startsWith(head + " ");
  }

  // Translate the glob to a regex
  let body = "";
  for (let i = 0; i < specifier.length; i++) {
    const c = specifier[i];
    if (c === "*") {
      if (specifier[i + 1] === "*") {
        body += ".*";
        i++;
      } else {
        body += "[^/]*";
      }
    } else if (/[.+^${}()|[\]\\?]/.test(c)) {
      body += "\\" + c;
    } else {
      body += c;
    }
  }
  return new RegExp("^" + body + "$").test(candidate);
}
