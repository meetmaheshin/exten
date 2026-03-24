import * as vscode from "vscode";
import * as path from "node:path";
import { exec } from "node:child_process";

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
  constructor(private outputChannel: vscode.OutputChannel) {}

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<ToolResult> {
    this.outputChannel.appendLine(`[Tool] ${toolName}: ${JSON.stringify(toolInput).slice(0, 200)}`);

    try {
      switch (toolName) {
        case "read_file":
          return await this.readFile(toolInput);
        case "write_file":
          return await this.writeFile(toolInput);
        case "edit_file":
          return await this.editFile(toolInput);
        case "run_terminal":
          return await this.runTerminal(toolInput);
        case "search_files":
          return await this.searchFiles(toolInput);
        case "list_directory":
          return await this.listDirectory(toolInput);
        case "glob_files":
          return await this.globFiles(toolInput);
        default:
          return { result: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Tool Error] ${toolName}: ${msg}`);
      return { result: msg, isError: true };
    }
  }

  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error("No workspace folder open");
    }
    return folders[0].uri.fsPath;
  }

  private resolvePath(relativePath: string): string {
    const root = this.getWorkspaceRoot();
    const resolved = path.resolve(root, relativePath);

    // Security: prevent path traversal outside workspace
    if (!resolved.startsWith(root)) {
      throw new Error(`Path escapes workspace: ${relativePath}`);
    }
    return resolved;
  }

  // ─── read_file ───
  private async readFile(input: Record<string, unknown>): Promise<ToolResult> {
    if (!input.path || typeof input.path !== "string") {
      return { result: "read_file requires a 'path' parameter", isError: true };
    }
    const filePath = this.resolvePath(input.path);
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
  private async writeFile(input: Record<string, unknown>): Promise<ToolResult> {
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

    const bytes = Buffer.from(content, "utf-8");
    await vscode.workspace.fs.writeFile(uri, bytes);

    // Open the file in the editor so the user can see it
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });

    return { result: `File written: ${input.path} (${content.split("\n").length} lines)`, isError: false };
  }

  // ─── edit_file ───
  private async editFile(input: Record<string, unknown>): Promise<ToolResult> {
    if (!input.path || typeof input.path !== "string") {
      return { result: "edit_file requires a 'path' parameter", isError: true };
    }
    if (!input.old_text || typeof input.old_text !== "string") {
      return { result: "edit_file requires a non-empty 'old_text' parameter", isError: true };
    }
    const filePath = this.resolvePath(input.path);
    const uri = vscode.Uri.file(filePath);
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

    const linesChanged = newText.split("\n").length - oldText.split("\n").length;
    const changeDesc = linesChanged > 0 ? `+${linesChanged} lines` : linesChanged < 0 ? `${linesChanged} lines` : "lines unchanged";
    return { result: `Edited ${input.path} (${changeDesc})`, isError: false };
  }

  // ─── run_terminal ───
  private async runTerminal(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const cwd = input.cwd ? this.resolvePath(input.cwd as string) : this.getWorkspaceRoot();
    const timeout = Math.min(Number(input.timeout_ms) || DEFAULT_TIMEOUT, MAX_TIMEOUT);

    return new Promise<ToolResult>((resolve) => {
      exec(command, { cwd, timeout, maxBuffer: MAX_OUTPUT_SIZE, shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash" }, (error, stdout, stderr) => {
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

    // Use VSCode's findTextInFiles API via ripgrep under the hood
    const results: string[] = [];
    let count = 0;

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
          const limited = lines.slice(0, maxResults);
          const resultText = limited.join("\n") + (lines.length > maxResults ? `\n\n... (${lines.length - maxResults} more matches)` : "");

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
      // Skip common non-useful directories
      if (name === "node_modules" || name === ".git" || name === "dist" || name === ".next") continue;

      const fullPath = path.join(dirPath, name);
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
    const uris = await vscode.workspace.findFiles(include, "**/node_modules/**", 200);

    const root = this.getWorkspaceRoot();
    const files = uris.map((u) => path.relative(root, u.fsPath).replace(/\\/g, "/")).sort();

    return {
      result: files.join("\n") || "No files matched the pattern.",
      isError: false,
    };
  }
}
