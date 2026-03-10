import { useState } from "react";
import type { ToolCallDisplay as ToolCallData } from "../types";

interface ToolCallDisplayProps {
  toolCall: ToolCallData;
}

const TOOL_ICONS: Record<string, string> = {
  read_file: "\u{1F4C4}",
  write_file: "\u{270F}\u{FE0F}",
  edit_file: "\u{2702}\u{FE0F}",
  run_terminal: "\u{1F4BB}",
  search_files: "\u{1F50D}",
  list_directory: "\u{1F4C1}",
  glob_files: "\u{1F4C2}",
};

const TOOL_LABELS: Record<string, string> = {
  read_file: "Read File",
  write_file: "Write File",
  edit_file: "Edit File",
  run_terminal: "Terminal",
  search_files: "Search",
  list_directory: "List Directory",
  glob_files: "Find Files",
};

function formatInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
      return String(input.path || "");
    case "run_terminal":
      return String(input.command || "");
    case "search_files":
      return String(input.pattern || "");
    case "list_directory":
      return String(input.path || ".");
    case "glob_files":
      return String(input.pattern || "");
    default:
      return JSON.stringify(input).slice(0, 100);
  }
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const icon = TOOL_ICONS[toolCall.toolName] || "\u{1F527}";
  const label = TOOL_LABELS[toolCall.toolName] || toolCall.toolName;
  const summary = formatInput(toolCall.toolName, toolCall.toolInput);

  const statusClass =
    toolCall.status === "error" || toolCall.status === "denied"
      ? "tool-status-error"
      : toolCall.status === "completed"
        ? "tool-status-success"
        : "tool-status-running";

  return (
    <div className={`tool-call ${statusClass}`}>
      <div
        className="tool-call-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <span className="tool-call-icon">{icon}</span>
        <span className="tool-call-label">{label}</span>
        <span className="tool-call-summary">{summary}</span>
        <span className="tool-call-status">
          {toolCall.status === "pending" && "\u23F3"}
          {toolCall.status === "running" && "\u2699\uFE0F"}
          {toolCall.status === "completed" && "\u2705"}
          {toolCall.status === "error" && "\u274C"}
          {toolCall.status === "denied" && "\u{1F6AB}"}
        </span>
        <span className={`tool-call-expand ${expanded ? "expanded" : ""}`}>
          &#9654;
        </span>
      </div>
      {expanded && (
        <div className="tool-call-details">
          {toolCall.toolName === "edit_file" && toolCall.toolInput.old_text && (
            <div className="tool-call-diff">
              <div className="diff-remove">{String(toolCall.toolInput.old_text).slice(0, 500)}</div>
              <div className="diff-add">{String(toolCall.toolInput.new_text || "").slice(0, 500)}</div>
            </div>
          )}
          {toolCall.toolName === "run_terminal" && (
            <div className="tool-call-terminal">
              <code>$ {String(toolCall.toolInput.command)}</code>
            </div>
          )}
          {toolCall.result && (
            <pre className="tool-call-output">
              {toolCall.result.slice(0, 2000)}
              {toolCall.result.length > 2000 ? "\n... (truncated)" : ""}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
