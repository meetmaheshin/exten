import { useState, useEffect } from "react";
import type { ToolCallDisplay as ToolCallData } from "../types";

interface ToolCallDisplayProps {
  toolCall: ToolCallData;
  /** Auto-expand this tool call (used for the latest running tool) */
  autoExpand?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  run_terminal: "Bash",
  search_files: "Grep",
  list_directory: "List",
  glob_files: "Glob",
};

/** Generate a short human-readable description of what the tool is doing */
function formatDescription(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
      return String(input.path || "file");
    case "write_file":
      return `Write to ${input.path || "file"}`;
    case "edit_file":
      return `Edit ${input.path || "file"}`;
    case "run_terminal": {
      const cmd = String(input.command || "");
      // Truncate long commands
      return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
    }
    case "search_files":
      return `Search for "${input.pattern || ""}"`;
    case "list_directory":
      return `List ${input.path || "."}`;
    case "glob_files":
      return `Find ${input.pattern || "files"}`;
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}

/** Format the IN (input) block content */
function formatInputBlock(toolName: string, input: Record<string, unknown>): string | null {
  switch (toolName) {
    case "run_terminal":
      return String(input.command || "");
    case "read_file":
      return String(input.path || "");
    case "write_file":
      return String(input.path || "");
    case "edit_file": {
      const path = String(input.path || "");
      const old_text = String(input.old_text || "");
      const new_text = String(input.new_text || "");
      return `${path}\n\nFind:\n${old_text.slice(0, 300)}\n\nReplace:\n${new_text.slice(0, 300)}`;
    }
    case "search_files":
      return `pattern: ${input.pattern || ""}\npath: ${input.path || "."}`;
    case "glob_files":
      return `pattern: ${input.pattern || ""}`;
    case "list_directory":
      return String(input.path || ".");
    default:
      return JSON.stringify(input, null, 2).slice(0, 500);
  }
}

/** Truncate output for display */
function formatOutput(result: string): string {
  if (result.length > 1500) {
    return result.slice(0, 1500) + "\n... (truncated)";
  }
  return result;
}

export function ToolCallDisplay({ toolCall, autoExpand }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Auto-expand when this is the latest running tool
  useEffect(() => {
    if (autoExpand && (toolCall.status === "running" || toolCall.status === "pending")) {
      setExpanded(true);
    }
  }, [autoExpand, toolCall.status]);

  // Elapsed timer for running tools
  useEffect(() => {
    if (toolCall.status !== "running" && toolCall.status !== "pending") {
      return;
    }
    setElapsed(0);
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [toolCall.status]);
  const label = TOOL_LABELS[toolCall.toolName] || toolCall.toolName;
  const description = formatDescription(toolCall.toolName, toolCall.toolInput);
  const inputBlock = formatInputBlock(toolCall.toolName, toolCall.toolInput);

  const isRunning = toolCall.status === "running" || toolCall.status === "pending";
  const isError = toolCall.status === "error" || toolCall.status === "denied";
  const isComplete = toolCall.status === "completed";

  const dotClass = isError ? "tc-dot-error" : isComplete ? "tc-dot-success" : "tc-dot-running";

  return (
    <div className="tc-item">
      {/* Header row: dot + label + description */}
      <div
        className="tc-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <span className={`tc-dot ${dotClass}`} />
        <span className="tc-label">{label}</span>
        <span className="tc-desc">{description}</span>
        {isRunning && elapsed > 0 && (
          <span className="tc-elapsed">{elapsed}s</span>
        )}
        <span className={`tc-chevron ${expanded ? "tc-chevron-open" : ""}`}>&#9654;</span>
      </div>

      {/* Expanded: IN/OUT blocks */}
      {expanded && (
        <div className="tc-body">
          {inputBlock && (
            <div className="tc-block">
              <div className="tc-block-label">IN</div>
              <pre className="tc-block-content">{inputBlock}</pre>
            </div>
          )}
          {toolCall.result && (
            <div className={`tc-block ${toolCall.isError ? "tc-block-error" : ""}`}>
              <div className="tc-block-label">OUT</div>
              <pre className="tc-block-content">{formatOutput(toolCall.result)}</pre>
            </div>
          )}
          {isRunning && !toolCall.result && (
            <div className="tc-block">
              <div className="tc-block-label">OUT</div>
              <pre className="tc-block-content tc-running-text">Running...</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
