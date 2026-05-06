import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

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

  /** Personal-only rules file (gitignored). Concatenated AFTER team rules. */
  private candidateLocalRuleFiles(): vscode.Uri[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return [];
    const root = folders[0].uri;
    return [
      vscode.Uri.joinPath(root, ".ailancers", "instructions.local.md"),
    ];
  }

  /** Read the optional gitignored personal rules file. Best-effort; returns "". */
  async getLocalProjectRules(): Promise<string> {
    for (const uri of this.candidateLocalRuleFiles()) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(bytes).toString("utf-8");
        return content.length > 8000 ? content.slice(0, 8000) + "\n…(truncated)" : content;
      } catch {
        // try next candidate
      }
    }
    return "";
  }

  /**
   * User-level rules file at `~/.ailancers/instructions.md`. Applied across
   * all projects — useful for personal preferences ("always use TypeScript
   * strict mode", "I prefer functional style over OO") that don't belong in a
   * shared `.ailancers/instructions.md`. Concatenated BEFORE project rules
   * so project-specific rules override.
   */
  async getUserRules(): Promise<string> {
    const userPath = path.join(os.homedir(), ".ailancers", "instructions.md");
    try {
      const content = fs.readFileSync(userPath, "utf-8");
      return content.length > 8000 ? content.slice(0, 8000) + "\n…(truncated)" : content;
    } catch {
      return "";
    }
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

  /**
   * Path-scoped rules. Reads `.ailancers/rules/*.md`; each file may carry
   * YAML frontmatter with a `paths:` array of globs. A rule is included for
   * the current turn only when the active editor's workspace-relative path
   * matches one of those globs. Files without `paths:` (or with no
   * frontmatter) are always included — same as a `paths: ["**"]`.
   *
   * The shape is intentionally tiny:
   *   ---
   *   paths:
   *     - "src/api/**"
   *     - "tests/**\/*.api.ts"
   *   ---
   *   <markdown body>
   *
   * Concatenated AFTER `getProjectRules` and BEFORE `getLocalProjectRules`
   * by the caller. Cached per file by mtime so repeat sends in the same
   * editor context don't re-read everything.
   */
  private cachedScopedRules: Map<string, { content: string; paths: string[]; mtime: number }> = new Map();

  async getPathScopedRules(activeRelPath?: string): Promise<string> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return "";
    const root = folders[0].uri;
    const dir = vscode.Uri.joinPath(root, ".ailancers", "rules");
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      // No rules directory — silent skip.
      return "";
    }

    const matchedBlocks: string[] = [];
    for (const [name, kind] of entries) {
      if (kind !== vscode.FileType.File) continue;
      if (!name.endsWith(".md")) continue;
      const fileUri = vscode.Uri.joinPath(dir, name);
      const stat = await vscode.workspace.fs.stat(fileUri);

      let entry = this.cachedScopedRules.get(name);
      if (!entry || entry.mtime !== stat.mtime) {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        const raw = Buffer.from(bytes).toString("utf-8");
        const parsed = parseFrontmatter(raw);
        // Cap each rule body at 4KB — they're meant to be small focused
        // overrides, not full documents.
        const body = parsed.body.length > 4000
          ? parsed.body.slice(0, 4000) + "\n…(truncated)"
          : parsed.body;
        entry = { content: body, paths: parsed.paths, mtime: stat.mtime };
        this.cachedScopedRules.set(name, entry);
      }

      // No paths list → always include.
      const matches = entry.paths.length === 0
        ? true
        : !!activeRelPath && entry.paths.some((g) => matchGlob(g, activeRelPath));
      if (matches && entry.content.trim().length > 0) {
        matchedBlocks.push(`<!-- from .ailancers/rules/${name} -->\n${entry.content.trim()}`);
      }
    }
    if (matchedBlocks.length === 0) return "";
    return matchedBlocks.join("\n\n");
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

    // Pull current Problems-panel diagnostics for the active file. The agent
    // picks these up automatically — closes a 4.2 quality gap with no UI work.
    let diagnostics: string | undefined;
    try {
      const all = vscode.languages.getDiagnostics(editor.document.uri);
      if (all.length > 0) {
        const lines = all.slice(0, 25).map((d) => {
          const sev = d.severity === vscode.DiagnosticSeverity.Error ? "error"
            : d.severity === vscode.DiagnosticSeverity.Warning ? "warning"
            : d.severity === vscode.DiagnosticSeverity.Information ? "info"
            : "hint";
          const code = d.code ? ` [${typeof d.code === "object" ? d.code.value : d.code}]` : "";
          return `line ${d.range.start.line + 1}: ${sev}${code}: ${d.message}`;
        });
        diagnostics = lines.join("\n");
        if (all.length > 25) diagnostics += `\n…(${all.length - 25} more)`;
      }
    } catch {
      // best-effort
    }

    return {
      activeFile,
      languageId: editor.document.languageId,
      selection,
      selectionStart,
      selectionEnd,
      // Best-effort additions — backend wraps these into <editor_context>.
      // Cast is required only because the shared-type doesn't list them yet;
      // the backend treats them as optional strings.
      ...(root ? { workspaceRoot: root.replace(/\\/g, "/") } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    } as import("@ailancers/shared-types").WsAgentMessage["editorContext"];
  }
}

// ─── helpers ────────────────────────────────────────────────────────

/**
 * Tiny YAML-ish frontmatter parser. Only handles the subset we need:
 *   ---
 *   paths:
 *     - "glob1"
 *     - "glob2"
 *   ---
 *
 * Returns `{ paths: [], body: <content without frontmatter> }`. Anything
 * we don't understand is silently ignored — frontmatter is optional. We
 * deliberately don't pull in `js-yaml` for this single use.
 */
function parseFrontmatter(raw: string): { paths: string[]; body: string } {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!fmMatch) return { paths: [], body: raw };
  const fm = fmMatch[1];
  const body = fmMatch[2];

  // Look for `paths:` block — either inline `paths: ["a", "b"]` or YAML list.
  const paths: string[] = [];
  const inline = /^paths:\s*\[([^\]]*)\]\s*$/m.exec(fm);
  if (inline) {
    const items = inline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    paths.push(...items);
  } else {
    const block = /^paths:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)/m.exec(fm);
    if (block) {
      for (const line of block[1].split(/\r?\n/)) {
        const item = /^\s*-\s*(.+?)\s*$/.exec(line);
        if (item) paths.push(item[1].replace(/^["']|["']$/g, ""));
      }
    }
  }
  return { paths, body };
}

/**
 * Minimal glob matcher: handles `*` (segment), `**` (multi-segment),
 * `?` (single char), and literal directory separators. Forward slashes
 * only — caller normalises Windows paths first. Sufficient for the
 * `paths:` frontmatter use case; not a replacement for `picomatch`.
 */
function matchGlob(glob: string, target: string): boolean {
  // Normalise both sides — use forward slashes only.
  const g = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  const t = target.replace(/\\/g, "/").replace(/^\.\//, "");
  // Build a regex from the glob: escape regex metas, then translate
  // glob tokens. Order matters: `**` before `*`, then `?`.
  const re = "^" + g
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "(?:.+/)?")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]") + "$";
  try {
    return new RegExp(re).test(t);
  } catch {
    return false;
  }
}
