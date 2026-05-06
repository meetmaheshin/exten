import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Permission decision audit log.
 *
 * Every tool invocation that goes through the permission flow appends a
 * single JSONL line to `.ailancers/audit.log` under the workspace root.
 * Forensic value — useful for debugging "why did the agent deny this tool"
 * after the fact, and for security review of past sessions.
 *
 * Format (one record per line):
 *   {
 *     "ts": "2026-05-06T12:34:56.789Z",
 *     "tool": "edit_file",
 *     "input": { ... summarised ... },
 *     "source": "rule" | "hook" | "prompt" | "session-allow" | "fallback-allow",
 *     "decision": "allow" | "ask" | "deny",
 *     "rule": "Edit(src/**)" | null
 *   }
 *
 * Capped at 5 MB — when the file exceeds the cap we rotate it in place
 * (truncate to the last 4 MB of records) so a long-running workspace
 * doesn't grow unbounded. Failures are silent — auditing must never block
 * a tool call.
 */
export interface AuditEntry {
  ts: string;
  tool: string;
  input: Record<string, unknown>;
  source: "rule" | "hook" | "prompt" | "session-allow" | "fallback-allow";
  decision: "allow" | "ask" | "deny";
  rule?: string | null;
  /** When the user prompted, what they picked. Only present on `source: "prompt"`. */
  userChoice?: "allow" | "allowAll" | "deny";
  /** Free-text reason the host attached (e.g. hook block reason). */
  reason?: string;
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const ROTATE_KEEP_BYTES = 4 * 1024 * 1024;

export class PermissionAuditLog {
  /** Resolved on first append; null when no workspace is open. */
  private getLogPath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return path.join(folders[0].uri.fsPath, ".ailancers", "audit.log");
  }

  /** Summarise tool input so we don't log multi-MB write_file payloads.
   *  Keeps the keys but truncates string values past 200 chars. */
  private summariseInput(input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "string") {
        out[k] = v.length > 200 ? `${v.slice(0, 200)}…(+${v.length - 200} chars)` : v;
      } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
        out[k] = v;
      } else {
        // Objects/arrays — JSON-serialise with the same length cap.
        try {
          const json = JSON.stringify(v);
          out[k] = json.length > 200 ? `${json.slice(0, 200)}…` : v;
        } catch {
          out[k] = "[unserialisable]";
        }
      }
    }
    return out;
  }

  append(entry: Omit<AuditEntry, "ts" | "input"> & { input: Record<string, unknown> }): void {
    const logPath = this.getLogPath();
    if (!logPath) return;
    try {
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Rotate if over the cap.
      try {
        const stat = fs.statSync(logPath);
        if (stat.size > MAX_LOG_BYTES) {
          const buf = fs.readFileSync(logPath);
          const keep = buf.slice(buf.length - ROTATE_KEEP_BYTES);
          // Drop everything before the next newline so we don't start with
          // half a record.
          const firstNl = keep.indexOf(0x0a);
          const aligned = firstNl >= 0 ? keep.slice(firstNl + 1) : keep;
          fs.writeFileSync(logPath, aligned);
        }
      } catch { /* missing file — fine, will be created below */ }

      const record: AuditEntry = {
        ts: new Date().toISOString(),
        tool: entry.tool,
        input: this.summariseInput(entry.input),
        source: entry.source,
        decision: entry.decision,
        rule: entry.rule ?? null,
        ...(entry.userChoice ? { userChoice: entry.userChoice } : {}),
        ...(entry.reason ? { reason: entry.reason } : {}),
      };
      fs.appendFileSync(logPath, JSON.stringify(record) + "\n");
    } catch {
      // Auditing must never block a tool — swallow.
    }
  }

  /** Resolve to the file URI users can open. Null if no workspace. */
  getLogUri(): vscode.Uri | null {
    const p = this.getLogPath();
    return p ? vscode.Uri.file(p) : null;
  }
}
