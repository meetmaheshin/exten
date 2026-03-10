import type Anthropic from "@anthropic-ai/sdk";
import { DESTRUCTIVE_TOOLS, AUTO_APPROVED_COMMANDS } from "@ailancers/shared-types";
import type { ToolName } from "@ailancers/shared-types";

// ═══════════════════════════════════════════════════
// Claude Tool Definitions for Agentic Coding
// These define what tools Claude can call during an agent session
// ═══════════════════════════════════════════════════

export const AGENT_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "Read the contents of a file at the given path. Returns the file content as text with line numbers. " +
      "Use this to understand existing code before making changes. " +
      "For large files, use offset and limit to read specific sections.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root (e.g. 'src/index.ts')",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-based). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read. Optional, defaults to 2000.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Create a new file or completely overwrite an existing file with the given content. " +
      "Use this when creating new files or when you need to replace the entire file content. " +
      "For partial edits, prefer edit_file instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root",
        },
        content: {
          type: "string",
          description: "The complete file content to write",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Make a surgical edit to a file by replacing a specific string with new content. " +
      "The old_text must match exactly (including whitespace and indentation). " +
      "This is preferred over write_file for modifying existing files as it preserves context.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root",
        },
        old_text: {
          type: "string",
          description: "The exact text to find and replace (must be unique in the file)",
        },
        new_text: {
          type: "string",
          description: "The replacement text",
        },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "run_terminal",
    description:
      "Execute a shell command and return its stdout/stderr output. " +
      "Use this for running builds, tests, git commands, package managers, etc. " +
      "Commands run in the workspace root directory by default.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        cwd: {
          type: "string",
          description: "Working directory relative to workspace root. Optional.",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds. Defaults to 30000 (30s). Max 120000 (2min).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "search_files",
    description:
      "Search for a regex pattern across files in the workspace. " +
      "Returns matching lines with file paths and line numbers. " +
      "Similar to ripgrep/grep. Use this to find code patterns, function definitions, imports, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for",
        },
        path: {
          type: "string",
          description: "Directory to search in, relative to workspace root. Optional, defaults to '.'",
        },
        include_glob: {
          type: "string",
          description: "Glob pattern to filter files (e.g. '*.ts', 'src/**/*.tsx'). Optional.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of matching lines to return. Defaults to 100.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_directory",
    description:
      "List files and directories at the given path. " +
      "Returns entries with type indicators ([file] or [dir]). " +
      "Use this to explore project structure.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root. Defaults to '.' (root).",
        },
        recursive: {
          type: "boolean",
          description: "If true, list recursively. Defaults to false.",
        },
        max_depth: {
          type: "number",
          description: "Maximum recursion depth (only when recursive=true). Defaults to 3.",
        },
      },
      required: [],
    },
  },
  {
    name: "glob_files",
    description:
      "Find files matching a glob pattern in the workspace. " +
      "Returns a list of matching file paths. " +
      "Use this to find files by name or extension pattern.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g. '**/*.test.ts', 'src/**/*.tsx', 'package.json')",
        },
        path: {
          type: "string",
          description: "Base directory for the search. Optional, defaults to workspace root.",
        },
      },
      required: ["pattern"],
    },
  },
];

/** Check whether a tool call requires user approval */
export function requiresApproval(toolName: string, toolInput: Record<string, unknown>): boolean {
  if (!DESTRUCTIVE_TOOLS.has(toolName as ToolName)) {
    return false;
  }

  // Terminal commands: auto-approve safe read-only commands
  if (toolName === "run_terminal" && typeof toolInput.command === "string") {
    const cmd = toolInput.command.trim();
    return !AUTO_APPROVED_COMMANDS.some(
      (safe) => cmd === safe || cmd.startsWith(safe + " ")
    );
  }

  // write_file and edit_file always require approval
  return true;
}

/** System prompt for agent mode */
export const AGENT_SYSTEM_PROMPT = `You are an expert coding assistant integrated into the user's VS Code editor. You have access to their workspace and can read, write, edit files, run terminal commands, and search their codebase.

Key behaviors:
- Read files before modifying them to understand existing code
- Use edit_file for surgical changes; write_file only for new files or complete rewrites
- Run tests after making changes to verify correctness
- Be precise with file paths — they are relative to the workspace root
- When making multiple related changes, explain your plan first, then execute
- If a command fails, analyze the error and try a different approach
- Keep the user informed of what you're doing and why

You are working on the user's local machine through their VS Code extension. All file operations and commands execute in their workspace.`;
