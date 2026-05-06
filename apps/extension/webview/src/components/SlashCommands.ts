/**
 * Slash-command registry — webview-side. Phase 1 commands all reuse existing
 * behaviour we already have wired up (newConversation, exportConversation,
 * model picker state, etc.) — they're just a faster way to invoke it.
 */

export interface SlashCommandDef {
  /** What the user types after `/`. e.g. `clear`, `model`, `agent`. */
  name: string;
  /** Optional aliases, also leading `/` style. e.g. `new` for `clear`. */
  aliases?: string[];
  /** Short one-line description shown in the picker. */
  description: string;
  /** Argument hint shown to the right of the name. e.g. `<id>`. */
  argHint?: string;
  /** Group label for visual organisation in the picker. */
  group: "Conversation" | "Agent" | "Model" | "Help" | "Custom";
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  // ─── Conversation ───
  {
    name: "clear",
    aliases: ["new"],
    description: "Start a new conversation",
    group: "Conversation",
  },
  {
    name: "copy",
    description: "Copy the last AI response to clipboard",
    group: "Conversation",
  },
  {
    name: "export",
    argHint: "<markdown|json>",
    description: "Export the current conversation",
    group: "Conversation",
  },
  {
    name: "cost",
    aliases: ["usage", "stats"],
    description: "Show this session's cost & token usage",
    group: "Conversation",
  },
  // ─── Agent ───
  {
    name: "agent",
    argHint: "<coder|qa|design>",
    description: "Switch agent type",
    group: "Agent",
  },
  {
    name: "plan",
    argHint: "[on|off|toggle]",
    description: "Toggle plan mode (read-only, propose changes)",
    group: "Agent",
  },
  // ─── Model ───
  {
    name: "model",
    argHint: "<id>",
    description: "Switch model",
    group: "Model",
  },
  // ─── Conversation ───
  {
    name: "init",
    description: "Generate starter project rules from your repo metadata",
    group: "Conversation",
  },
  {
    name: "hooks",
    description: "Edit PreToolUse / PostToolUse hooks in .ailancers/settings.json",
    group: "Conversation",
  },
  // ─── Conversation ───
  {
    name: "context",
    description: "Show what's consuming context in this conversation",
    group: "Conversation",
  },
  {
    name: "compact",
    description: "Summarise older turns to free up context window",
    group: "Conversation",
  },
  {
    name: "permissions",
    argHint: "[log]",
    description: "Open .ailancers/settings.json — `/permissions log` opens the decision audit log",
    group: "Conversation",
  },
  {
    name: "memory",
    description: "Pick a rules / instructions file to open or create",
    group: "Conversation",
  },
  {
    name: "commands",
    description: "Open .ailancers/commands/ — author your own slash commands",
    group: "Conversation",
  },
  // ─── Help ───
  {
    name: "help",
    description: "Show available slash commands",
    group: "Help",
  },
];

/**
 * Parse a raw input string. If it's a slash command, return `{ name, args }`
 * with `name` lowercased. Otherwise return null. Only strips the leading `/`
 * if it's at the very start; doesn't try to parse mid-line `/` characters.
 */
export function parseSlashCommand(raw: string): { name: string; args: string } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  // A slash command line is a single line — multi-line input is treated as a
  // regular message even if it starts with `/`.
  if (trimmed.includes("\n")) return null;
  const body = trimmed.slice(1);
  const spaceIdx = body.indexOf(" ");
  if (spaceIdx === -1) return { name: body.toLowerCase(), args: "" };
  return {
    name: body.slice(0, spaceIdx).toLowerCase(),
    args: body.slice(spaceIdx + 1).trim(),
  };
}

/**
 * Resolve a typed name (or alias) to a command def. Returns null on miss.
 */
export function resolveCommand(name: string): SlashCommandDef | null {
  const lower = name.toLowerCase();
  return SLASH_COMMANDS.find((c) => c.name === lower || c.aliases?.includes(lower)) ?? null;
}

/**
 * Filter the registry against a typed prefix. Empty prefix returns all.
 * Matches command name OR any alias OR description (case-insensitive substring).
 * Custom user-authored commands can be merged in via the second arg — they're
 * appended under the "Custom" group so they're easy to spot in the picker.
 */
export function filterCommands(
  prefix: string,
  custom: { name: string; description?: string; argHint?: string }[] = [],
): SlashCommandDef[] {
  const customDefs: SlashCommandDef[] = custom.map((c) => ({
    name: c.name,
    description: c.description ?? "Custom command",
    argHint: c.argHint,
    group: "Custom",
  }));
  const all = [...SLASH_COMMANDS, ...customDefs];
  const q = prefix.trim().toLowerCase();
  if (!q) return all;
  return all.filter((c) => {
    if (c.name.includes(q)) return true;
    if (c.aliases?.some((a) => a.includes(q))) return true;
    if (c.description.toLowerCase().includes(q)) return true;
    return false;
  });
}
