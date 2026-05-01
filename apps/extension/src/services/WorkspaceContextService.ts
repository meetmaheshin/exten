import * as vscode from "vscode";
import * as path from "node:path";

/**
 * Reads ambient workspace context that we want auto-included on every
 * agent message:
 *   - Project rules from .ailancers/instructions.md (or AILANCERS.md fallback)
 *   - The active editor's file path, language, and selection
 *
 * All methods are best-effort: a missing file or no editor returns empty
 * — the caller falls back to default behavior.
 */
export class WorkspaceContextService {
  private cachedRules: { content: string; mtime: number; uri: string } | null = null;

  /** Path to the rules file we'll try, in priority order */
  private candidateRuleFiles(): vscode.Uri[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return [];
    const root = folders[0].uri;
    return [
      vscode.Uri.joinPath(root, ".ailancers", "instructions.md"),
      vscode.Uri.joinPath(root, "AILANCERS.md"),
    ];
  }

  /**
   * Read the project rules file. Cached based on mtime so we don't re-read
   * on every keystroke. Returns "" if no rules file is set up.
   */
  async getProjectRules(): Promise<string> {
    for (const uri of this.candidateRuleFiles()) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (this.cachedRules && this.cachedRules.uri === uri.toString() && this.cachedRules.mtime === stat.mtime) {
          return this.cachedRules.content;
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(bytes).toString("utf-8");
        // Cap at 16KB so we don't blow the system prompt budget
        const truncated = content.length > 16_000 ? content.slice(0, 16_000) + "\n…(truncated)" : content;
        this.cachedRules = { content: truncated, mtime: stat.mtime, uri: uri.toString() };
        return truncated;
      } catch {
        // Try next candidate
      }
    }
    this.cachedRules = null;
    return "";
  }

  /** Snapshot of the active editor right now */
  getEditorContext(): import("@ailancers/shared-types").WsAgentMessage["editorContext"] | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    const folders = vscode.workspace.workspaceFolders;
    const root = folders?.[0]?.uri.fsPath;
    let activeFile: string | undefined;
    if (root && editor.document.uri.fsPath.startsWith(root)) {
      activeFile = path.relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
    } else {
      activeFile = editor.document.uri.fsPath;
    }

    const sel = editor.selection;
    let selection: string | undefined;
    let selectionStart: number | undefined;
    let selectionEnd: number | undefined;
    if (!sel.isEmpty) {
      const text = editor.document.getText(sel);
      // Cap at 4KB so we don't drown the user message in selected boilerplate
      selection = text.length > 4000 ? text.slice(0, 4000) + "\n…(truncated)" : text;
      selectionStart = sel.start.line + 1;
      selectionEnd = sel.end.line + 1;
    }

    return {
      activeFile,
      languageId: editor.document.languageId,
      selection,
      selectionStart,
      selectionEnd,
    };
  }
}
