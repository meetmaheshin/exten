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

function formatDetail(toolName: string, toolInput: Record<string, unknown>): { title: string; lines: string[] } {
  switch (toolName) {
    case "write_file": {
      const path = String(toolInput.path || "unknown");
      const content = String(toolInput.content || "");
      const lineCount = content.split("\n").length;
      return {
        title: `Create / Overwrite File`,
        lines: [`File: ${path}`, `${lineCount} lines`, content.slice(0, 300) + (content.length > 300 ? "..." : "")],
      };
    }
    case "edit_file": {
      const path = String(toolInput.path || "unknown");
      const oldText = String(toolInput.old_text || "");
      const newText = String(toolInput.new_text || "");
      return {
        title: `Edit File: ${path}`,
        lines: [
          "Find:",
          oldText.slice(0, 200) + (oldText.length > 200 ? "..." : ""),
          "",
          "Replace:",
          newText.slice(0, 200) + (newText.length > 200 ? "..." : ""),
        ],
      };
    }
    case "run_terminal": {
      const cmd = String(toolInput.command || "");
      const cwd = toolInput.cwd ? String(toolInput.cwd) : null;
      return {
        title: "Run Command",
        lines: [`$ ${cmd}`, ...(cwd ? [`in ${cwd}`] : [])],
      };
    }
    default:
      return {
        title: toolName,
        lines: [JSON.stringify(toolInput, null, 2).slice(0, 300)],
      };
  }
}

export function ApprovalCard({ approval, onDecision }: ApprovalCardProps) {
  const icon = TOOL_ICONS[approval.toolName] || "\u{1F527}";
  const label = TOOL_LABELS[approval.toolName] || approval.toolName;
  const { title, lines } = formatDetail(approval.toolName, approval.toolInput);

  return (
    <div className="approval-card">
      <div className="approval-header">
        <span className="approval-icon">{icon}</span>
        <span className="approval-label">{label}</span>
        <span className="approval-title">{title}</span>
      </div>
      <div className="approval-detail">
        {lines.map((line, i) => (
          <div key={i} className="approval-detail-line">{line}</div>
        ))}
      </div>
      <div className="approval-actions">
        <button
          className="approval-btn approval-btn-allow"
          onClick={() => onDecision(approval.toolCallId, "allow")}
        >
          Allow
        </button>
        <button
          className="approval-btn approval-btn-allow-all"
          onClick={() => onDecision(approval.toolCallId, "allowAll")}
        >
          Allow All
        </button>
        <button
          className="approval-btn approval-btn-deny"
          onClick={() => onDecision(approval.toolCallId, "deny")}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
