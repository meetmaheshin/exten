import {
  parsePermissionRule,
  specifierMatches,
  type AilancersSettings,
} from "@ailancers/shared-types";

export type PermissionDecision = "deny" | "ask" | "allow" | null;

/**
 * Map our internal tool names to the human-friendly labels used in the
 * `Tool(specifier)` rule grammar. Keeping this small + intentional rather
 * than auto-derived so we don't silently start matching against new tools
 * users haven't written rules for.
 */
const TOOL_LABEL: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  run_terminal: "Bash",
  search_files: "Grep",
  list_directory: "List",
  glob_files: "Glob",
  find_symbol: "Symbol",
  figma_read: "Figma",
  get_diagnostics: "Diagnostics",
};

/**
 * For a given tool + input, return the candidate string that rules match
 * against. e.g. `Bash(npm test)` matches when candidate = `"npm test"`.
 * Returns null if we don't know how to extract a candidate (rule won't fire).
 */
function candidateFor(toolName: string, toolInput: Record<string, unknown>): string | null {
  switch (toolName) {
    case "run_terminal": {
      const cmd = typeof toolInput.command === "string" ? toolInput.command : "";
      return cmd.trim() || null;
    }
    case "read_file":
    case "write_file":
    case "edit_file":
    case "list_directory":
    case "glob_files": {
      const p = typeof toolInput.path === "string" ? toolInput.path : "";
      return p || null;
    }
    case "search_files": {
      const pattern = typeof toolInput.pattern === "string" ? toolInput.pattern : "";
      return pattern || null;
    }
    case "find_symbol": {
      const q = typeof toolInput.query === "string" ? toolInput.query : "";
      return q || null;
    }
    case "figma_read": {
      const url = typeof toolInput.url === "string" ? toolInput.url : "";
      return url || null;
    }
    default:
      return null;
  }
}

/** Split a Bash command on `&&` / `||` / `;` / `|` (quote-aware). Same logic as
 *  `splitCompoundCommand` in agentTools.ts but inline here so the extension
 *  doesn't need a backend round-trip to evaluate. */
function splitBashCompound(cmd: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    const next = cmd[i + 1];
    if (c === "\\" && (next === "'" || next === '"' || next === "`")) {
      buf += c + next;
      i++;
      continue;
    }
    if (!inDouble && !inBacktick && c === "'") inSingle = !inSingle;
    else if (!inSingle && !inBacktick && c === '"') inDouble = !inDouble;
    else if (!inSingle && !inDouble && c === "`") inBacktick = !inBacktick;
    if (!inSingle && !inDouble && !inBacktick) {
      if ((c === "&" && next === "&") || (c === "|" && next === "|")) {
        if (buf.trim()) parts.push(buf.trim());
        buf = "";
        i++;
        continue;
      }
      if (c === ";" || c === "|") {
        if (buf.trim()) parts.push(buf.trim());
        buf = "";
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function ruleMatches(toolLabel: string, candidate: string, ruleStr: string, isBash: boolean): boolean {
  const rule = parsePermissionRule(ruleStr);
  if (!rule || rule.tool !== toolLabel) return false;
  // Bash compound: every subcommand must match the allow rule, but ANY
  // subcommand matching a deny/ask is enough to trigger it. The caller
  // distinguishes by which rule list it's iterating.
  if (isBash) {
    const subs = splitBashCompound(candidate);
    if (rule.specifier === undefined) return true;
    return subs.every((s) => specifierMatches(rule.specifier, s));
  }
  return specifierMatches(rule.specifier, candidate);
}

function anyRuleMatches(toolLabel: string, candidate: string, rules: string[], isBash: boolean): boolean {
  // For deny/ask: any subcommand match counts.
  if (isBash) {
    const subs = splitBashCompound(candidate);
    return rules.some((ruleStr) => {
      const rule = parsePermissionRule(ruleStr);
      if (!rule || rule.tool !== toolLabel) return false;
      if (rule.specifier === undefined) return true;
      return subs.some((s) => specifierMatches(rule.specifier, s));
    });
  }
  return rules.some((r) => ruleMatches(toolLabel, candidate, r, false));
}

/**
 * Evaluate a tool call against the user's persisted permission rules.
 * Returns:
 *   • `"deny"`  → block immediately, don't even prompt
 *   • `"ask"`   → force a user prompt (overrides any allow)
 *   • `"allow"` → skip the prompt the backend would have asked for
 *   • `null`    → no rule matched; fall through to default behavior
 */
/**
 * Hardcoded preset deny list — applies to every project regardless of
 * `.ailancers/settings.json`. Catches the most common foot-guns (writing
 * over `.env*` / `.git/**` / `.ailancers/**` / `.husky/**`) before the
 * user has bothered to set up their own deny rules. Users can't opt out
 * — these protect critical state. If a workflow legitimately needs to
 * touch one of these (e.g. a git hook installer), the user can grant a
 * one-shot via the approval prompt; the preset only blocks unattended
 * writes. We deliberately do NOT preset `Read` blocks for these paths
 * because reading `.git/HEAD` etc. is a normal agent operation.
 */
const PRESET_DENY_RULES: string[] = [
  "Edit(.env*)",
  "Write(.env*)",
  "Edit(.env)",
  "Write(.env)",
  "Edit(**/.env*)",
  "Write(**/.env*)",
  "Edit(.git/**)",
  "Write(.git/**)",
  "Edit(.husky/**)",
  "Write(.husky/**)",
  "Edit(.ailancers/**)",
  "Write(.ailancers/**)",
];

export function evaluatePermission(
  settings: AilancersSettings | null,
  toolName: string,
  toolInput: Record<string, unknown>,
): PermissionDecision {
  const label = TOOL_LABEL[toolName];
  if (!label) return null;
  const candidate = candidateFor(toolName, toolInput);
  if (candidate === null) return null;
  const isBash = label === "Bash";

  // Hardcoded preset deny — runs before settings-based rules so it can't
  // be bypassed by a project allow rule. Reads are intentionally not
  // preset-blocked so the agent can still inspect protected files.
  if (anyRuleMatches(label, candidate, PRESET_DENY_RULES, isBash)) {
    return "deny";
  }

  if (!settings?.permissions) return null;
  const { allow, deny, ask } = settings.permissions;

  // Deny wins — evaluated first.
  if (deny && anyRuleMatches(label, candidate, deny, isBash)) return "deny";
  // Then ask — also overrides allow.
  if (ask && anyRuleMatches(label, candidate, ask, isBash)) return "ask";
  // Then allow — for Bash, every subcommand must match SOME allow rule.
  if (allow && allow.length > 0) {
    if (isBash) {
      const subs = splitBashCompound(candidate);
      const everyAllowed = subs.every((sub) =>
        allow.some((ruleStr) => {
          const rule = parsePermissionRule(ruleStr);
          if (!rule || rule.tool !== label) return false;
          return specifierMatches(rule.specifier, sub);
        })
      );
      if (everyAllowed) return "allow";
    } else {
      if (allow.some((r) => ruleMatches(label, candidate, r, false))) return "allow";
    }
  }
  return null;
}
