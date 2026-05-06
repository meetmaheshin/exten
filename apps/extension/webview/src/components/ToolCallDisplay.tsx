import { useState, useEffect } from "react";
import type { ToolCallDisplay as ToolCallData } from "../types";
import { getVsCodeApi } from "../vscodeApi";

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
  get_diagnostics: "Diagnostics",
};

/** Compute "+X −Y" diffstat for an edit_file / write_file tool call. */
function formatDiffstat(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === "edit_file") {
    const oldText = typeof input.old_text === "string" ? input.old_text : "";
    const newText = typeof input.new_text === "string" ? input.new_text : "";
    const removed = oldText ? oldText.split("\n").length : 0;
    const added = newText ? newText.split("\n").length : 0;
    if (removed === 0 && added === 0) return null;
    return `+${added} −${removed}`;
  }
  if (toolName === "write_file") {
    const content = typeof input.content === "string" ? input.content : "";
    if (!content) return null;
    return `+${content.split("\n").length}`;
  }
  return null;
}

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

const PREVIEW_LIMIT = 1500;

function copy(text: string) {
  try { navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

/** Render `read_file` output with a clear gutter — line number on the left,
 *  text on the right. Tool returns lines in the form `<lineno>\t<text>`; we
 *  parse that back out so the gutter is visually distinct from the content
 *  (and so a copy stays clean). */
function ReadFileResult({ text }: { text: string }) {
  const trailingMeta = /\n\n\(Showing lines [\d-]+ of \d+ total\)\s*$/m;
  const metaMatch = trailingMeta.exec(text);
  const body = metaMatch ? text.slice(0, metaMatch.index) : text;
  const meta = metaMatch ? text.slice(metaMatch.index).trim() : null;
  const lines = body.split("\n");
  return (
    <div className="tc-read-file">
      <pre className="tc-read-file-pre">
        {lines.map((line, i) => {
          const tabIdx = line.indexOf("\t");
          if (tabIdx === -1) {
            return (
              <div className="tc-read-row" key={i}>
                <span className="tc-read-gutter" />
                <span className="tc-read-content">{line}</span>
              </div>
            );
          }
          return (
            <div className="tc-read-row" key={i}>
              <span className="tc-read-gutter">{line.slice(0, tabIdx)}</span>
              <span className="tc-read-content">{line.slice(tabIdx + 1)}</span>
            </div>
          );
        })}
      </pre>
      {meta && <div className="tc-read-meta">{meta}</div>}
    </div>
  );
}

/** Render `search_files` output as a clickable match list. ripgrep emits
 *  `<path>:<lineno>:<match>` per line; if it doesn't parse we fall back to
 *  raw text. Each match opens the file at the right line via the host. */
function SearchFilesResult({ text }: { text: string }) {
  // The executor sometimes appends "\n\n... (N more matches)" and "No matches found." sentinel.
  // Treat those as plain footers below the match list.
  const trailingMore = /\n\n\.\.\. \(\d+ more matches\)\s*$/;
  const moreMatch = trailingMore.exec(text);
  const main = moreMatch ? text.slice(0, moreMatch.index) : text;
  const moreLine = moreMatch ? text.slice(moreMatch.index).trim() : null;

  if (!main.trim() || main.trim() === "No matches found.") {
    return <pre className="tc-block-content">{text}</pre>;
  }

  const lines = main.split("\n").filter(Boolean);
  // Each line: `<path>:<lineno>:<rest>` (rest can contain colons).
  type Match = { path: string; line: number; preview: string; raw: string };
  const matches: Match[] = [];
  let unparseable = false;
  for (const line of lines) {
    // Find "path:line:" prefix; allow Windows drive letters by re-locating the
    // second colon if the first split looks like a drive letter (e.g. "C:").
    let firstColon = line.indexOf(":");
    if (firstColon === 1 && /[A-Za-z]/.test(line[0])) {
      firstColon = line.indexOf(":", 2);
    }
    if (firstColon === -1) { unparseable = true; break; }
    const secondColon = line.indexOf(":", firstColon + 1);
    if (secondColon === -1) { unparseable = true; break; }
    const path = line.slice(0, firstColon);
    const lineno = Number(line.slice(firstColon + 1, secondColon));
    if (!Number.isFinite(lineno)) { unparseable = true; break; }
    const preview = line.slice(secondColon + 1);
    matches.push({ path, line: lineno, preview, raw: line });
  }
  if (unparseable) {
    return <pre className="tc-block-content">{text}</pre>;
  }

  return (
    <div className="tc-search-result">
      <ul className="tc-search-list">
        {matches.map((m, i) => (
          <li key={i} className="tc-search-item">
            <button
              className="tc-search-link"
              onClick={(e) => {
                e.stopPropagation();
                getVsCodeApi().postMessage({ type: "openFile", path: m.path, line: m.line });
              }}
              title={`Open ${m.path}:${m.line}`}
            >
              <span className="tc-search-path">{m.path}</span>
              <span className="tc-search-lineno">:{m.line}</span>
            </button>
            <span className="tc-search-preview">{m.preview}</span>
          </li>
        ))}
      </ul>
      {moreLine && <div className="tc-search-more">{moreLine}</div>}
    </div>
  );
}

export function ToolCallDisplay({ toolCall, autoExpand }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFullOutput, setShowFullOutput] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Auto-expand when this is the latest running tool
  useEffect(() => {
    if (autoExpand && (toolCall.status === "running" || toolCall.status === "pending")) {
      setExpanded(true);
    }
  }, [autoExpand, toolCall.status]);

  // Listen for the global "expand/collapse all tool calls" custom events.
  // Emitted by the App-level keybinding; lets every mounted ToolCallDisplay
  // flip its own state without prop-drilling.
  useEffect(() => {
    const onExpand = () => setExpanded(true);
    const onCollapse = () => setExpanded(false);
    window.addEventListener("ailancers:expand-all-tools", onExpand);
    window.addEventListener("ailancers:collapse-all-tools", onCollapse);
    return () => {
      window.removeEventListener("ailancers:expand-all-tools", onExpand);
      window.removeEventListener("ailancers:collapse-all-tools", onCollapse);
    };
  }, []);

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
  const diffstat = formatDiffstat(toolCall.toolName, toolCall.toolInput);

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
        aria-expanded={expanded}
        aria-label={`${label} ${description}${diffstat ? ` ${diffstat}` : ""}`}
      >
        <span className={`tc-dot ${dotClass}`} />
        <span className="tc-label">{label}</span>
        <span className="tc-desc">{description}</span>
        {diffstat && <span className="tc-diffstat">{diffstat}</span>}
        {isRunning && elapsed > 0 && (
          <span className="tc-elapsed">{elapsed}s</span>
        )}
        <span className={`tc-chevron ${expanded ? "tc-chevron-open" : ""}`}>&#9654;</span>
      </div>

      {/* Expanded: IN/OUT blocks */}
      {expanded && (
        <div className="tc-body">
          {/* edit_file gets the same find/replace styling the approval card
              uses — much easier to scan than the raw IN block. */}
          {toolCall.toolName === "edit_file" ? (
            <>
              <div className="tc-block">
                <div className="tc-block-label-row">
                  <span className="tc-block-label tc-block-label-remove">- Find</span>
                  <button className="tc-copy-btn" onClick={(e) => { e.stopPropagation(); copy(String(toolCall.toolInput.old_text || "")); }} title="Copy find text">📋</button>
                </div>
                <pre className="tc-block-content tc-block-remove">{String(toolCall.toolInput.old_text || "")}</pre>
              </div>
              <div className="tc-block">
                <div className="tc-block-label-row">
                  <span className="tc-block-label tc-block-label-add">+ Replace</span>
                  <button className="tc-copy-btn" onClick={(e) => { e.stopPropagation(); copy(String(toolCall.toolInput.new_text || "")); }} title="Copy replace text">📋</button>
                </div>
                <pre className="tc-block-content tc-block-add">{String(toolCall.toolInput.new_text || "")}</pre>
              </div>
            </>
          ) : toolCall.toolName === "write_file" ? (
            <div className="tc-block">
              <div className="tc-block-label-row">
                <span className="tc-block-label tc-block-label-add">+ New file content</span>
                <button className="tc-copy-btn" onClick={(e) => { e.stopPropagation(); copy(String(toolCall.toolInput.content || "")); }} title="Copy file content">📋</button>
              </div>
              <pre className="tc-block-content tc-block-add">{String(toolCall.toolInput.content || "")}</pre>
            </div>
          ) : inputBlock && (
            <div className="tc-block">
              <div className="tc-block-label-row">
                <span className="tc-block-label">IN</span>
                <button className="tc-copy-btn" onClick={(e) => { e.stopPropagation(); copy(inputBlock); }} title="Copy input">📋</button>
              </div>
              <pre className="tc-block-content">{inputBlock}</pre>
            </div>
          )}
          {toolCall.result && (() => {
            const result = toolCall.result;
            const isLong = result.length > PREVIEW_LIMIT;
            const display = !isLong || showFullOutput ? result : result.slice(0, PREVIEW_LIMIT) + "\n…";
            // Per-tool custom OUT renderers replace the raw `<pre>` block for
            // tools where structure matters more than the raw text. Falls
            // through to the generic block on long-truncated views (we keep
            // the truncation behaviour to avoid huge DOM trees on big reads).
            const isReadFile = toolCall.toolName === "read_file" && !isError;
            const isSearchFiles = toolCall.toolName === "search_files" && !isError;
            const useCustomBody = (isReadFile || isSearchFiles) && (!isLong || showFullOutput);
            return (
              <div className={`tc-block ${toolCall.isError ? "tc-block-error" : ""}`}>
                <div className="tc-block-label-row">
                  <span className="tc-block-label">OUT{isLong ? ` (${result.length.toLocaleString()} chars)` : ""}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {isLong && (
                      <button
                        className="tc-copy-btn"
                        onClick={(e) => { e.stopPropagation(); setShowFullOutput((v) => !v); }}
                        title={showFullOutput ? "Show less" : "Show full output"}
                      >
                        {showFullOutput ? "Show less" : `Show all`}
                      </button>
                    )}
                    <button className="tc-copy-btn" onClick={(e) => { e.stopPropagation(); copy(result); }} title="Copy full output">📋</button>
                  </div>
                </div>
                {useCustomBody && isReadFile ? (
                  <ReadFileResult text={display} />
                ) : useCustomBody && isSearchFiles ? (
                  <SearchFilesResult text={display} />
                ) : (
                  <pre className="tc-block-content">{display}</pre>
                )}
              </div>
            );
          })()}
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
