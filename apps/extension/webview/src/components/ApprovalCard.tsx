import { useEffect, useRef } from "react";
import type { PendingApproval } from "../types";
import { getVsCodeApi } from "../vscodeApi";

interface ApprovalCardProps {
  approval: PendingApproval;
  onDecision: (
    toolCallId: string,
    decision: "allow" | "allowAll" | "deny",
    editedInput?: Record<string, unknown>,
  ) => void;
}

const TOOL_ICONS: Record<string, string> = {
  write_file: "\u270F\uFE0F",
  edit_file: "\u2702\uFE0F",
  run_terminal: "\u{1F4BB}",
};

const TOOL_LABELS: Record<string, string> = {
  write_file: "Write File",
  edit_file: "Edit File",
  run_terminal: "Run Command",
};

interface DiffSection {
  /** "find/replace" | "command" | "file write" | "raw" */
  kind: "find-replace" | "command" | "file-write" | "raw";
  path?: string;
  oldText?: string;
  newText?: string;
  command?: string;
  cwd?: string;
  content?: string;   // full file content for write_file
  raw?: string;       // pretty-printed JSON fallback
}

function buildSection(toolName: string, toolInput: Record<string, unknown>): { title: string; section: DiffSection } {
  switch (toolName) {
    case "write_file": {
      const path = String(toolInput.path || "unknown");
      const content = String(toolInput.content || "");
      const lines = content.split("\n").length;
      return {
        title: `Create or overwrite ${path} (${lines} line${lines === 1 ? "" : "s"})`,
        section: { kind: "file-write", path, content },
      };
    }
    case "edit_file": {
      const path = String(toolInput.path || "unknown");
      const oldText = String(toolInput.old_text || "");
      const newText = String(toolInput.new_text || "");
      return {
        title: `Edit ${path}`,
        section: { kind: "find-replace", path, oldText, newText },
      };
    }
    case "run_terminal": {
      const cmd = String(toolInput.command || "");
      const cwd = toolInput.cwd ? String(toolInput.cwd) : undefined;
      return { title: "Run command", section: { kind: "command", command: cmd, cwd } };
    }
    default:
      return {
        title: toolName,
        section: { kind: "raw", raw: JSON.stringify(toolInput, null, 2) },
      };
  }
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    // ignore — webview clipboard API is sometimes restricted
  }
}

/** Map our tool names to the labels used in `Tool(specifier)` rules. */
const RULE_TOOL_LABEL: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  run_terminal: "Bash",
};

/**
 * Suggest a permission rule string for "always allow this kind of action".
 * Heuristics:
 *   • Bash: keep the leading binary + first arg if it's `run`/`test`/etc.,
 *     replace the rest with `*`. Bare commands stay exact.
 *   • Edit/Write: rule the directory containing the path with `**`.
 *   • Read: rule the directory with `**`.
 * Returns null if we can't synthesize a sensible rule (caller hides the button).
 */
function suggestAllowRule(toolName: string, toolInput: Record<string, unknown>): string | null {
  const label = RULE_TOOL_LABEL[toolName];
  if (!label) return null;

  if (toolName === "run_terminal") {
    const cmd = String(toolInput.command || "").trim();
    if (!cmd) return null;
    // Keep verb + first qualifier (e.g. "npm run", "git status"), wildcard the rest.
    const parts = cmd.split(/\s+/);
    if (parts.length === 1) return `${label}(${parts[0]})`;
    const head = parts.slice(0, 2).join(" ");
    return `${label}(${head} *)`;
  }

  // File tools: glob the directory.
  const p = String(toolInput.path || "");
  if (!p) return null;
  // Strip trailing filename, keep the dir, append /**
  const slash = p.lastIndexOf("/");
  const dir = slash >= 0 ? p.slice(0, slash) : ".";
  return `${label}(${dir}/**)`;
}

export function ApprovalCard({ approval, onDecision }: ApprovalCardProps) {
  const icon = TOOL_ICONS[approval.toolName] || "\u{1F527}";
  const label = TOOL_LABELS[approval.toolName] || approval.toolName;
  const { title, section } = buildSection(approval.toolName, approval.toolInput);
  const suggestedRule = suggestAllowRule(approval.toolName, approval.toolInput);

  // Focus management — autofocus the primary "Allow" button when the card
  // mounts; restore the previously-focused element when it unmounts.
  const allowBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    allowBtnRef.current?.focus();
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        try { previouslyFocused.focus(); } catch { /* element may be gone */ }
      }
    };
  }, []);

  return (
    <div className="approval-card" role="alertdialog" aria-label={`Approval required: ${label}`} aria-modal="false">
      <div className="approval-header">
        <span className="approval-icon">{icon}</span>
        <span className="approval-label">{label}</span>
        <span className="approval-title">{title}</span>
      </div>

      <div className="approval-detail">
        {section.kind === "find-replace" && (
          <>
            <div className="approval-block">
              <div className="approval-block-header">
                <span className="approval-block-label approval-block-label-remove">- Find</span>
                <button className="approval-copy-btn" onClick={() => copyToClipboard(section.oldText ?? "")} title="Copy">📋</button>
              </div>
              <pre className="approval-block-content approval-block-remove">{section.oldText}</pre>
            </div>
            <div className="approval-block">
              <div className="approval-block-header">
                <span className="approval-block-label approval-block-label-add">+ Replace</span>
                <button className="approval-copy-btn" onClick={() => copyToClipboard(section.newText ?? "")} title="Copy">📋</button>
              </div>
              <pre className="approval-block-content approval-block-add">{section.newText}</pre>
            </div>
          </>
        )}
        {section.kind === "file-write" && (
          <div className="approval-block">
            <div className="approval-block-header">
              <span className="approval-block-label approval-block-label-add">+ New file content</span>
              <button className="approval-copy-btn" onClick={() => copyToClipboard(section.content ?? "")} title="Copy">📋</button>
            </div>
            <pre className="approval-block-content approval-block-add">{section.content}</pre>
          </div>
        )}
        {section.kind === "command" && (
          <div className="approval-block">
            <div className="approval-block-header">
              <span className="approval-block-label">$ Command</span>
              <button className="approval-copy-btn" onClick={() => copyToClipboard(section.command ?? "")} title="Copy">📋</button>
            </div>
            <pre className="approval-block-content">$ {section.command}</pre>
            {section.cwd && <div className="approval-detail-line" style={{ paddingTop: 4, opacity: 0.7 }}>in {section.cwd}</div>}
          </div>
        )}
        {section.kind === "raw" && (
          <div className="approval-block">
            <pre className="approval-block-content">{section.raw}</pre>
          </div>
        )}
      </div>

      <div className="approval-actions">
        {(approval.toolName === "edit_file" || approval.toolName === "write_file") && (
          <>
            <button
              className="approval-btn approval-btn-diff"
              onClick={() => {
                const path = String(approval.toolInput.path || "");
                if (!path) return;
                if (approval.toolName === "edit_file") {
                  getVsCodeApi().postMessage({
                    type: "showProposedDiff",
                    path,
                    oldText: String(approval.toolInput.old_text || ""),
                    newText: String(approval.toolInput.new_text || ""),
                  });
                } else {
                  getVsCodeApi().postMessage({
                    type: "showProposedDiff",
                    path,
                    content: String(approval.toolInput.content || ""),
                  });
                }
              }}
              title="Open the proposed change in VS Code's side-by-side diff editor"
              aria-label="View diff in editor"
            >
              ⇄ View diff
            </button>
            <button
              className="approval-btn approval-btn-edit-approve"
              onClick={() => {
                // Open the proposed full-file content as an untitled doc
                // for inline editing. When the user closes the tab, the host
                // posts `editableProposedClosed` with the final text. The
                // App handler folds that into the approval response — we
                // deliberately don't dispatch the decision now so the user
                // still has the chance to deny instead.
                getVsCodeApi().postMessage({
                  type: "openEditableProposed",
                  toolCallId: approval.toolCallId,
                });
              }}
              title="Open the proposed content for inline editing. After you close the tab, click Allow to apply your edited version."
              aria-label="Edit before approving"
            >
              ✎ Edit before approve
            </button>
          </>
        )}
        <button
          ref={allowBtnRef}
          className="approval-btn approval-btn-allow"
          onClick={() => onDecision(approval.toolCallId, "allow")}
          aria-label={`Allow: ${title}`}
        >
          ✓ Allow
        </button>
        <button
          className="approval-btn approval-btn-allow-all"
          onClick={() => onDecision(approval.toolCallId, "allowAll")}
          title="Skip this prompt for the rest of this conversation"
          aria-label={`Allow all ${label} for this chat`}
        >
          Allow all (this chat)
        </button>
        {suggestedRule && (
          <button
            className="approval-btn approval-btn-allow-rule"
            onClick={() => {
              getVsCodeApi().postMessage({ type: "writeAllowRule", rule: suggestedRule });
              onDecision(approval.toolCallId, "allow");
            }}
            title={`Append ${suggestedRule} to .ailancers/settings.json so this is allowed in every future conversation.`}
            aria-label={`Always allow ${suggestedRule}`}
          >
            ⤓ Always allow <code>{suggestedRule}</code>
          </button>
        )}
        <button
          className="approval-btn approval-btn-deny"
          onClick={() => onDecision(approval.toolCallId, "deny")}
          aria-label={`Deny: ${title}`}
        >
          ✗ Deny
        </button>
      </div>
    </div>
  );
}
