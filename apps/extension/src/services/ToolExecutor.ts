import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { exec, type ChildProcess } from "node:child_process";
import type { ApiClient } from "./ApiClient";

const MAX_FILE_SIZE = 100 * 1024; // 100KB max for read output
const MAX_WRITE_SIZE = 1024 * 1024; // 1MB max for write
const MAX_OUTPUT_SIZE = 50 * 1024; // 50KB max for terminal output
const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;
const MAX_SEARCH_RESULTS = 100;

export interface ToolResult {
  result: string;
  isError: boolean;
}

export class ToolExecutor {
  constructor(private outputChannel: vscode.OutputChannel, private apiClient?: ApiClient) {}

  async execute(toolName: string, toolInput: Record<string, unknown>, abortSignal?: AbortSignal): Promise<ToolResult> {
    this.outputChannel.appendLine(`[Tool] ${toolName}: ${JSON.stringify(toolInput).slice(0, 200)}`);

    if (abortSignal?.aborted) {
      return { result: "Tool cancelled before execution.", isError: true };
    }

    try {
      switch (toolName) {
        case "read_file":
          return await this.readFile(toolInput);
        case "write_file":
          return await this.writeFile(toolInput, abortSignal);
        case "edit_file":
          return await this.editFile(toolInput, abortSignal);
        case "run_terminal":
          return await this.runTerminal(toolInput, abortSignal);
        case "search_files":
          return await this.searchFiles(toolInput);
        case "list_directory":
          return await this.listDirectory(toolInput);
        case "glob_files":
          return await this.globFiles(toolInput);
        case "find_symbol":
          return await this.findSymbol(toolInput);
        case "figma_read":
          return await this.figmaRead(toolInput);
        case "get_diagnostics":
          return await this.getDiagnostics(toolInput);
        default:
          return { result: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Tool Error] ${toolName}: ${msg}`);
      return { result: msg, isError: true };
    }
  }

  /**
   * Resolve the workspace root for tool ops. Falls back to the active editor's
   * directory when no folder is open, so the agent can still read/edit a file
   * the user is staring at in scratch-buffer mode. If neither exists, throws.
   */
  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) return folders[0].uri.fsPath;

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === "file") {
      return path.dirname(editor.document.uri.fsPath);
    }
    throw new Error("No workspace folder open. Open a folder or focus a file editor first.");
  }

  /**
   * Resolve a relative path within ANY workspace folder (multi-root aware) and
   * reject anything that canonically lives outside ALL of them. Tries each
   * root in order; the first existing match wins. Uses `realpath` so a symlink
   * inside the workspace pointing to `../../shared` can't slip past the prefix
   * check.
   */
  private resolvePath(relativePath: string): string {
    const folders = vscode.workspace.workspaceFolders;
    const roots: string[] = folders && folders.length > 0
      ? folders.map((f) => f.uri.fsPath)
      : [this.getWorkspaceRoot()]; // falls back to active editor's dir

    // Absolute path: still gate it against at least one workspace root.
    if (path.isAbsolute(relativePath)) {
      const realResolved = canonicaliseExistingAncestor(relativePath);
      for (const root of roots) {
        const realRoot = (() => {
          try { return fs.realpathSync(root); } catch { return root; }
        })();
        if (realResolved.startsWith(realRoot)) return relativePath;
      }
      throw new Error(`Path escapes workspace: ${relativePath}`);
    }

    // Relative: try each root, prefer one where the file already exists.
    let firstResolved: string | null = null;
    for (const root of roots) {
      const resolved = path.resolve(root, relativePath);
      const realRoot = (() => {
        try { return fs.realpathSync(root); } catch { return root; }
      })();
      const realResolved = canonicaliseExistingAncestor(resolved);
      if (!realResolved.startsWith(realRoot)) continue;
      if (firstResolved === null) firstResolved = resolved;
      try {
        // Prefer the root where the file already exists (real read/edit case)
        if (fs.existsSync(resolved)) return resolved;
      } catch { /* keep looking */ }
    }
    if (firstResolved !== null) return firstResolved;
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  /** Resolve which workspace root owns a given absolute path (for gitignore). */
  private rootForPath(absPath: string): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const f of folders) {
        if (absPath.startsWith(f.uri.fsPath)) return f.uri.fsPath;
      }
    }
    return this.getWorkspaceRoot();
  }

  /** Cached gitignore patterns per root (mtime-keyed). */
  private gitignoreCache: Map<string, { mtime: number; rules: GitignoreRule[] }> = new Map();

  /** Should we skip this path due to .gitignore? Honors `respectGitIgnore` setting. */
  private isGitIgnored(absPath: string): boolean {
    const respect = vscode.workspace
      .getConfiguration("ailancers")
      .get<boolean>("respectGitIgnore", true);
    if (!respect) return false;
    const root = this.rootForPath(absPath);
    const rel = path.relative(root, absPath).replace(/\\/g, "/");
    if (rel.startsWith("..")) return false;
    // Always skip these regardless of gitignore — they're noise even when
    // gitignore isn't present.
    if (rel === ".git" || rel.startsWith(".git/")) return true;

    const rules = this.loadGitignoreRules(root);
    return matchGitignore(rules, rel);
  }

  private loadGitignoreRules(root: string): GitignoreRule[] {
    const giPath = path.join(root, ".gitignore");
    let mtime = 0;
    try { mtime = fs.statSync(giPath).mtimeMs; } catch { mtime = 0; }
    const cached = this.gitignoreCache.get(root);
    if (cached && cached.mtime === mtime) return cached.rules;

    let raw = "";
    try { raw = fs.readFileSync(giPath, "utf-8"); } catch { /* no gitignore — empty rules */ }
    const rules = parseGitignore(raw);
    this.gitignoreCache.set(root, { mtime, rules });
    return rules;
  }

  // ─── read_file ───
  private async readFile(input: Record<string, unknown>): Promise<ToolResult> {
    if (!input.path || typeof input.path !== "string") {
      return { result: "read_file requires a 'path' parameter", isError: true };
    }
    const filePath = this.resolvePath(input.path);
    if (this.isGitIgnored(filePath) && !input.force) {
      return {
        result: `Refused to read ${input.path}: file is gitignored. Pass {"force": true} to read anyway.`,
        isError: true,
      };
    }
    const uri = vscode.Uri.file(filePath);

    const bytes = await vscode.workspace.fs.readFile(uri);
    let content = Buffer.from(bytes).toString("utf-8");

    const lines = content.split("\n");
    const offset = Math.max(1, Number(input.offset) || 1);
    const limit = Number(input.limit) || 2000;

    const sliced = lines.slice(offset - 1, offset - 1 + limit);
    content = sliced.map((line, i) => `${offset + i}\t${line}`).join("\n");

    if (content.length > MAX_FILE_SIZE) {
      content = content.slice(0, MAX_FILE_SIZE) + "\n... (truncated)";
    }

    const total = lines.length;
    if (offset + limit < total) {
      content += `\n\n(Showing lines ${offset}-${offset + sliced.length - 1} of ${total} total)`;
    }

    return { result: content, isError: false };
  }

  // ─── write_file ───
  private async writeFile(input: Record<string, unknown>, abortSignal?: AbortSignal): Promise<ToolResult> {
    if (!input.path || typeof input.path !== "string") {
      return { result: "write_file requires a 'path' parameter", isError: true };
    }
    const content = typeof input.content === "string" ? input.content : "";
    if (content.length > MAX_WRITE_SIZE) {
      return { result: `File content exceeds maximum size (${MAX_WRITE_SIZE / 1024}KB)`, isError: true };
    }

    const filePath = this.resolvePath(input.path);
    const uri = vscode.Uri.file(filePath);

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));

    if (abortSignal?.aborted) {
      return { result: "write_file cancelled before write.", isError: true };
    }

    const bytes = Buffer.from(content, "utf-8");
    await vscode.workspace.fs.writeFile(uri, bytes);

    // Open the file in the editor so the user can see it
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });

    return { result: `File written: ${input.path} (${content.split("\n").length} lines)`, isError: false };
  }

  // ─── edit_file ───
  private async editFile(input: Record<string, unknown>, abortSignal?: AbortSignal): Promise<ToolResult> {
    if (!input.path || typeof input.path !== "string") {
      return { result: "edit_file requires a 'path' parameter", isError: true };
    }
    const filePath = this.resolvePath(input.path);
    const uri = vscode.Uri.file(filePath);

    // Force-overwrite path: when the user edits the proposed content via the
    // "Edit before approve" workflow, the webview hands us a full-file
    // replacement under `__overwrite__` instead of `old_text`/`new_text`.
    // Skip the unique-find logic and write the whole file directly.
    if (typeof input.__overwrite__ === "string") {
      if (abortSignal?.aborted) {
        return { result: "edit_file cancelled before applying edit.", isError: true };
      }
      const proposed = input.__overwrite__;
      const doc = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length),
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullRange, proposed);
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) {
        return { result: `Failed to apply edit to ${input.path}`, isError: true };
      }
      await doc.save();
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
      const lines = proposed.split("\n").length;
      return { result: `Edited ${input.path} (overwritten, ${lines} lines) — user-edited content applied.`, isError: false };
    }

    if (!input.old_text || typeof input.old_text !== "string") {
      return { result: "edit_file requires a non-empty 'old_text' parameter", isError: true };
    }
    const oldText = input.old_text;
    const newText = typeof input.new_text === "string" ? input.new_text : "";

    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(bytes).toString("utf-8");

    const index = content.indexOf(oldText);
    if (index === -1) {
      return { result: `Could not find the specified text in ${input.path}. Make sure old_text matches exactly.`, isError: true };
    }

    // Check for uniqueness
    const secondIndex = content.indexOf(oldText, index + 1);
    if (secondIndex !== -1) {
      return { result: `The old_text appears multiple times in ${input.path}. Provide more context to make it unique.`, isError: true };
    }

    if (abortSignal?.aborted) {
      return { result: "edit_file cancelled before applying edit.", isError: true };
    }

    // Apply the edit using WorkspaceEdit for undo support
    const doc = await vscode.workspace.openTextDocument(uri);
    const startPos = doc.positionAt(index);
    const endPos = doc.positionAt(index + oldText.length);
    const range = new vscode.Range(startPos, endPos);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, newText);
    const success = await vscode.workspace.applyEdit(edit);

    if (!success) {
      return { result: `Failed to apply edit to ${input.path}`, isError: true };
    }

    // Save the document
    await doc.save();

    // Show the file
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });

    const oldLines = oldText.split("\n").length;
    const newLines = newText.split("\n").length;
    const added = Math.max(0, newLines - 0); // rough — we're replacing, so all new lines are "added"
    const removed = Math.max(0, oldLines - 0);
    return { result: `Edited ${input.path} (+${added} −${removed} lines)`, isError: false };
  }

  // ─── run_terminal ───
  private async runTerminal(input: Record<string, unknown>, abortSignal?: AbortSignal): Promise<ToolResult> {
    const command = input.command as string;
    const cwd = input.cwd ? this.resolvePath(input.cwd as string) : this.getWorkspaceRoot();
    const timeout = Math.min(Number(input.timeout_ms) || DEFAULT_TIMEOUT, MAX_TIMEOUT);

    // Track a `vscode.window.withProgress` indicator for commands that take
    // more than 2 seconds. The progress task awaits a deferred promise that
    // resolves when the exec finishes (or is cancelled). Lives on the status
    // bar (`ProgressLocation.Window`) so it's unobtrusive but discoverable.
    let progressResolve: (() => void) | null = null;
    let progressShown = false;
    const progressTimer = setTimeout(() => {
      progressShown = true;
      const cmdLabel = command.length > 60 ? command.slice(0, 57) + "…" : command;
      void vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: `Ailancers: ${cmdLabel}`,
          cancellable: false,
        },
        () => new Promise<void>((res) => { progressResolve = res; }),
      );
    }, 2000);
    const finishProgress = () => {
      clearTimeout(progressTimer);
      if (progressShown && progressResolve) {
        progressResolve();
        progressResolve = null;
      }
    };

    return new Promise<ToolResult>((resolve) => {
      let cancelled = false;
      let child: ChildProcess | null = null;

      const onAbort = () => {
        cancelled = true;
        if (child && !child.killed) {
          // SIGTERM first; OS will send SIGKILL if it ignores us
          try { child.kill("SIGTERM"); } catch { /* already dead */ }
        }
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          finishProgress();
          resolve({ result: "Command cancelled before start.", isError: true });
          return;
        }
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      child = exec(command, { cwd, timeout, maxBuffer: MAX_OUTPUT_SIZE, shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash" }, (error, stdout, stderr) => {
        abortSignal?.removeEventListener("abort", onAbort);
        finishProgress();

        if (cancelled) {
          resolve({ result: `$ ${command}\n(cancelled by user)`, isError: true });
          return;
        }

        let output = "";

        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n" : "") + stderr;

        if (output.length > MAX_OUTPUT_SIZE) {
          output = output.slice(0, MAX_OUTPUT_SIZE) + "\n... (truncated)";
        }

        if (error && !output) {
          output = error.message;
        }

        const exitCode = error?.code ?? 0;
        const header = `$ ${command}\nExit code: ${exitCode}\n\n`;

        resolve({
          result: header + (output || "(no output)"),
          isError: exitCode !== 0,
        });
      });
    });
  }

  // ─── search_files ───
  private async searchFiles(input: Record<string, unknown>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = input.path ? this.resolvePath(input.path as string) : this.getWorkspaceRoot();
    const includeGlob = (input.include_glob as string) || "**/*";
    const maxResults = Math.min(Number(input.max_results) || MAX_SEARCH_RESULTS, MAX_SEARCH_RESULTS);

    // Use exec with ripgrep for better performance
    const rgPath = this.findRipgrep();
    if (rgPath) {
      return new Promise<ToolResult>((resolve) => {
        const args = [
          "--line-number",
          "--no-heading",
          "--color=never",
          "--max-count=5", // max matches per file
          `--glob=${includeGlob}`,
          "--max-filesize=1M",
          pattern,
          searchPath,
        ];

        exec(`"${rgPath}" ${args.join(" ")}`, { maxBuffer: MAX_OUTPUT_SIZE, timeout: 30_000 }, (error, stdout) => {
          if (!stdout && error) {
            // Exit code 1 means no matches (not an error for rg)
            if ((error as NodeJS.ErrnoException).code === "1" || error.message.includes("exit code 1")) {
              resolve({ result: "No matches found.", isError: false });
              return;
            }
          }

          const lines = (stdout || "").split("\n").filter(Boolean);
          // Filter out gitignored results — rg already respects gitignore by
          // default but we're being defensive in case the ignore file lives
          // outside ripgrep's view (e.g. nested `.gitignore` not detected).
          const filtered = lines.filter((line) => {
            // rg output: "<path>:<lineno>:<match>"
            const colonIdx = line.indexOf(":");
            if (colonIdx === -1) return true;
            const filePath = line.slice(0, colonIdx);
            const abs = path.isAbsolute(filePath) ? filePath : path.join(searchPath, filePath);
            return !this.isGitIgnored(abs);
          });
          const limited = filtered.slice(0, maxResults);
          const resultText = limited.join("\n") + (filtered.length > maxResults ? `\n\n... (${filtered.length - maxResults} more matches)` : "");

          resolve({
            result: resultText || "No matches found.",
            isError: false,
          });
        });
      });
    }

    // Fallback: use VS Code's search API
    return { result: "Search not available (ripgrep not found)", isError: true };
  }

  private findRipgrep(): string | null {
    // VSCode bundles ripgrep
    try {
      const rgPath = path.join(vscode.env.appRoot, "node_modules", "@vscode", "ripgrep", "bin", "rg");
      return rgPath;
    } catch {
      return null;
    }
  }

  // ─── list_directory ───
  private async listDirectory(input: Record<string, unknown>): Promise<ToolResult> {
    const dirPath = input.path ? this.resolvePath(input.path as string) : this.getWorkspaceRoot();
    const recursive = Boolean(input.recursive);
    const maxDepth = Number(input.max_depth) || 3;

    const entries = await this.listDir(dirPath, recursive, maxDepth, 0);
    const root = this.getWorkspaceRoot();

    const lines = entries.map((e) => {
      const rel = path.relative(root, e.path).replace(/\\/g, "/");
      return `${e.type === "dir" ? "[dir]  " : "[file] "}${rel}`;
    });

    return {
      result: lines.join("\n") || "(empty directory)",
      isError: false,
    };
  }

  private async listDir(
    dirPath: string,
    recursive: boolean,
    maxDepth: number,
    depth: number
  ): Promise<Array<{ path: string; type: "file" | "dir" }>> {
    const uri = vscode.Uri.file(dirPath);
    const raw = await vscode.workspace.fs.readDirectory(uri);
    const results: Array<{ path: string; type: "file" | "dir" }> = [];

    for (const [name, type] of raw) {
      const fullPath = path.join(dirPath, name);
      // Honor .gitignore (configurable). The hardcoded skip-list lives only as
      // a final safety net for setups with no .gitignore at all.
      if (this.isGitIgnored(fullPath)) continue;
      if (
        name === "node_modules" || name === ".git" || name === "dist" || name === ".next"
      ) continue;

      const entryType = type === vscode.FileType.Directory ? "dir" : "file";
      results.push({ path: fullPath, type: entryType });

      if (recursive && entryType === "dir" && depth < maxDepth) {
        const children = await this.listDir(fullPath, true, maxDepth, depth + 1);
        results.push(...children);
      }
    }

    return results;
  }

  // ─── glob_files ───
  private async globFiles(input: Record<string, unknown>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const basePath = input.path as string | undefined;

    const include = basePath ? new vscode.RelativePattern(this.resolvePath(basePath), pattern) : pattern;
    const uris = await vscode.workspace.findFiles(include, "**/node_modules/**", 500);

    // Filter out gitignored matches. We over-fetched (500) so the visible list
    // still has plenty of useful results after filtering.
    const filtered = uris.filter((u) => !this.isGitIgnored(u.fsPath)).slice(0, 200);

    const root = this.getWorkspaceRoot();
    const files = filtered.map((u) => path.relative(root, u.fsPath).replace(/\\/g, "/")).sort();

    return {
      result: files.join("\n") || "No files matched the pattern.",
      isError: false,
    };
  }

  // ─── find_symbol ───
  // Uses VS Code's language server to find a function / class / variable by name
  // across the workspace. Returns location + signature, far better than ripgrep
  // for "where is foo defined" because it understands the language.
  private async findSymbol(input: Record<string, unknown>): Promise<ToolResult> {
    const query = (input.query as string ?? "").trim();
    const limit = Math.min((input.limit as number) ?? 20, 50);
    if (!query) return { result: "query is required", isError: true };

    const root = this.getWorkspaceRoot();

    interface SymbolHit {
      name: string;
      kind: string;
      file: string;
      line: number;
      containerName?: string;
    }

    // executeWorkspaceSymbolProvider returns SymbolInformation[] from the LSP
    const symbols = (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query,
    )) || [];

    if (symbols.length === 0) {
      return {
        result: `No symbol matching "${query}" found. Try search_files for raw text matches, or check that the relevant language extension is installed (e.g. "TypeScript and JavaScript Language Features").`,
        isError: false,
      };
    }

    const KIND_NAMES: Record<number, string> = {
      0: "File", 1: "Module", 2: "Namespace", 3: "Package", 4: "Class",
      5: "Method", 6: "Property", 7: "Field", 8: "Constructor", 9: "Enum",
      10: "Interface", 11: "Function", 12: "Variable", 13: "Constant",
      14: "String", 15: "Number", 16: "Boolean", 17: "Array",
    };

    const hits: SymbolHit[] = symbols.slice(0, limit).map((s) => ({
      name: s.name,
      kind: KIND_NAMES[s.kind] ?? `Kind${s.kind}`,
      file: path.relative(root, s.location.uri.fsPath).replace(/\\/g, "/"),
      line: s.location.range.start.line + 1,
      containerName: s.containerName || undefined,
    }));

    const lines = hits.map((h) => {
      const where = h.containerName ? ` in ${h.containerName}` : "";
      return `${h.kind}: ${h.name}${where} — ${h.file}:${h.line}`;
    });
    const truncatedNote = symbols.length > limit ? `\n…(${symbols.length - limit} more results truncated; refine the query)` : "";
    return {
      result: lines.join("\n") + truncatedNote,
      isError: false,
    };
  }

  // ─── get_diagnostics ───
  // Reads the Problems panel for the requested file (or workspace-wide).
  // Captures most of MCP's `mcp__ide__getDiagnostics` day-1 value without
  // requiring an MCP runtime.
  private async getDiagnostics(input: Record<string, unknown>): Promise<ToolResult> {
    const minSeverity = (input.severity as string) || "warning";
    const sevRank: Record<string, number> = { error: 0, warning: 1, info: 2, hint: 3 };
    const cutoff = sevRank[minSeverity] ?? 1;

    const sevName = (s: vscode.DiagnosticSeverity): string => {
      switch (s) {
        case vscode.DiagnosticSeverity.Error: return "error";
        case vscode.DiagnosticSeverity.Warning: return "warning";
        case vscode.DiagnosticSeverity.Information: return "info";
        default: return "hint";
      }
    };

    let pairs: [vscode.Uri, readonly vscode.Diagnostic[]][];
    if (input.path && typeof input.path === "string") {
      const filePath = this.resolvePath(input.path);
      const uri = vscode.Uri.file(filePath);
      pairs = [[uri, vscode.languages.getDiagnostics(uri)]];
    } else {
      pairs = vscode.languages.getDiagnostics();
    }

    const root = (() => {
      try { return this.getWorkspaceRoot(); } catch { return ""; }
    })();
    const lines: string[] = [];
    let totalCount = 0;
    for (const [uri, diags] of pairs) {
      if (uri.scheme !== "file") continue;
      const filtered = diags.filter((d) => sevRank[sevName(d.severity)] <= cutoff);
      if (filtered.length === 0) continue;
      const rel = root && uri.fsPath.startsWith(root)
        ? path.relative(root, uri.fsPath).replace(/\\/g, "/")
        : uri.fsPath;
      lines.push(`${rel}:`);
      for (const d of filtered.slice(0, 25)) {
        const code = d.code ? ` [${typeof d.code === "object" ? d.code.value : d.code}]` : "";
        lines.push(`  line ${d.range.start.line + 1}: ${sevName(d.severity)}${code}: ${d.message.replace(/\n/g, " ")}`);
        totalCount++;
      }
      if (filtered.length > 25) {
        lines.push(`  …(${filtered.length - 25} more)`);
        totalCount += filtered.length - 25;
      }
    }

    if (lines.length === 0) {
      return { result: "No diagnostics at or above severity '" + minSeverity + "'.", isError: false };
    }
    return {
      result: `${totalCount} diagnostic${totalCount === 1 ? "" : "s"} (severity ≥ ${minSeverity}):\n\n${lines.join("\n")}`,
      isError: false,
    };
  }

  // ─── figma_read ───
  // Calls our backend's /api/figma/read endpoint. The Figma token lives only on
  // the backend, so users don't need to set anything up locally.
  private async figmaRead(input: Record<string, unknown>): Promise<ToolResult> {
    const url = (input.url as string ?? "").trim();
    if (!url) return { result: "url is required", isError: true };
    if (!this.apiClient) return { result: "Internal error: API client not wired into ToolExecutor", isError: true };

    try {
      type FigmaNode = {
        id: string; name: string; type: string;
        size?: { width: number; height: number };
        colors?: string[];
        text?: string;
        font?: { family: string; size: number; weight?: number };
        children?: FigmaNode[];
      };
      type FigmaResp = {
        fileName: string;
        tree: FigmaNode;
        image: { mimeType: string; base64: string } | null;
        imageSourceUrl: string | null;
      };

      const data = await this.apiClient.get<FigmaResp>(
        `/api/figma/read?url=${encodeURIComponent(url)}`,
      );

      // Pretty-print the tree as indented text — much easier for Claude to reason
      // about than raw JSON, and roughly half the tokens.
      const lines: string[] = [];
      lines.push(`Figma file: ${data.fileName}`);
      lines.push("");

      const indent = (depth: number) => "  ".repeat(depth);
      const visit = (n: FigmaNode, depth: number) => {
        const parts: string[] = [`${n.type} "${n.name}"`];
        if (n.size) parts.push(`${n.size.width}×${n.size.height}`);
        if (n.colors && n.colors.length > 0) parts.push(`fills: ${n.colors.join(", ")}`);
        if (n.font) parts.push(`font: ${n.font.family} ${n.font.size}px${n.font.weight ? ` w${n.font.weight}` : ""}`);
        lines.push(`${indent(depth)}- ${parts.join(" · ")}`);
        if (n.text) lines.push(`${indent(depth + 1)}text: "${n.text.replace(/\n/g, " / ")}"`);
        if (n.children) for (const c of n.children) visit(c, depth + 1);
      };
      visit(data.tree, 0);

      if (data.image) {
        lines.push("");
        lines.push(`(rendered PNG fetched server-side, ${Math.round(data.image.base64.length / 1024)} KB — currently passed as text only; ` +
          `if the user asks you to "look at" the image, suggest they paste a screenshot of the Figma frame into the chat for direct vision.)`);
      } else if (data.imageSourceUrl) {
        lines.push("");
        lines.push(`(no PNG bytes returned, but Figma rendered URL: ${data.imageSourceUrl} — short-lived)`);
      }

      return { result: lines.join("\n"), isError: false };
    } catch (err) {
      return {
        result: `Figma read failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
}

/**
 * `fs.realpath` rejects on non-existent paths, but `resolvePath` is also called
 * for files we're about to create. Walk up to the nearest existing ancestor,
 * realpath that, then re-append the missing tail. This still defeats symlinks
 * pointing outside the workspace because the symlink itself must exist for the
 * traversal to start.
 */
function canonicaliseExistingAncestor(p: string): string {
  let current = p;
  let suffix = "";
  // Walk upward until we find something that exists
  while (current && current !== path.dirname(current)) {
    try {
      const real = fs.realpathSync(current);
      return suffix ? path.join(real, suffix) : real;
    } catch {
      suffix = path.join(path.basename(current), suffix);
      current = path.dirname(current);
    }
  }
  return p;
}

// ── Minimal gitignore matcher ───────────────────────────────────────────────
// Just enough to handle the patterns 99% of repos actually use. Not a
// drop-in replacement for `git check-ignore`. Notable supported features:
//   • leading `!` — negation
//   • leading `/` — root-anchored
//   • trailing `/` — directory-only
//   • `**` — match any number of dirs
//   • `*` — match a path segment (no `/`)
//   • `#` comments and blank lines ignored
// Order matters: rules are evaluated in declaration order; later rules win.

export interface GitignoreRule {
  /** RegExp built from the gitignore line */
  re: RegExp;
  /** True for `!foo` rules — they un-ignore */
  negate: boolean;
  /** True for `foo/` — only matches directories */
  dirOnly: boolean;
}

function parseGitignore(text: string): GitignoreRule[] {
  const out: GitignoreRule[] = [];
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    }

    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }

    // Anchor at root if the pattern starts with `/` or contains a `/` mid-string.
    let anchored = false;
    if (line.startsWith("/")) {
      anchored = true;
      line = line.slice(1);
    } else if (line.includes("/") && !line.startsWith("**/")) {
      anchored = true;
    }

    // Build a regex. Each segment translates as:
    //   `**`  → `.*`
    //   `*`   → `[^/]*`
    //   `?`   → `[^/]`
    //   anything else → escaped literal
    const re = gitignoreToRegex(line, anchored);
    out.push({ re, negate, dirOnly });
  }
  return out;
}

function gitignoreToRegex(pattern: string, anchored: boolean): RegExp {
  let body = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      // ** → match across path separators; * → match within a segment only
      if (pattern[i + 1] === "*") {
        // **/ at start: matches zero or more leading dirs
        body += ".*";
        i += 2;
        if (pattern[i] === "/") i++;
      } else {
        body += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      body += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      body += "\\" + c;
      i++;
    } else {
      body += c;
      i++;
    }
  }
  // Always allow matching either the path itself or anything beneath it
  // (gitignore: "foo" matches foo, foo/, and foo/bar). We'll handle that
  // in the matcher by trying both `pattern` and `pattern/...`.
  const prefix = anchored ? "^" : "(^|/)";
  return new RegExp(prefix + body + "(/|$)");
}

/** Returns true iff `relPath` (forward-slash, root-relative) is gitignored. */
function matchGitignore(rules: GitignoreRule[], relPath: string): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.re.test(relPath)) {
      ignored = !rule.negate;
    }
  }
  return ignored;
}
