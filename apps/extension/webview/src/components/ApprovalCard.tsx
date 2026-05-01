import type { PendingApproval } from "../types";

interface ApprovalCardProps {
  approval: PendingApproval;
  onDecision: (toolCallId: string, decision: "allow" | "allowAll" | "deny") => void;
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

export function ApprovalCard({ approval, onDecision }: ApprovalCardProps) {
  const icon = TOOL_ICONS[approval.toolName] || "\u{1F527}";
  const label = TOOL_LABELS[approval.toolName] || approval.toolName;
  const { title, section } = buildSection(approval.toolName, approval.toolInput);

  return (
    <div className="approval-card" role="alertdialog" aria-label="Approval required">
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
        <button
          className="approval-btn approval-btn-allow"
          onClick={() => onDecision(approval.toolCallId, "allow")}
        >
          ✓ Allow
        </button>
        <button
          className="approval-btn approval-btn-allow-all"
          onClick={() => onDecision(approval.toolCallId, "allowAll")}
          title="Skip this prompt for the rest of this conversation"
        >
          Allow all (this chat)
        </button>
        <button
          className="approval-btn approval-btn-deny"
          onClick={() => onDecision(approval.toolCallId, "deny")}
        >
          ✗ Deny
        </button>
      </div>
    </div>
  );
}
