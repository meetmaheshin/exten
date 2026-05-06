import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AilancersSettings } from "@ailancers/shared-types";

/**
 * Loads, merges and caches `.ailancers/settings.json` files from five scopes.
 * Lowest priority on top, highest at the bottom — later layers' scalars win,
 * permission lists are unioned across all layers (so a managed `deny` is
 * additive and can't be undone by anything below).
 *
 *   1. user      — `~/.ailancers/settings.json`
 *   2. project   — `<workspace>/.ailancers/settings.json` (checked in)
 *   3. local     — `<workspace>/.ailancers/settings.local.json` (gitignored)
 *   4. cli       — file at `$AILANCERS_SETTINGS` env var, if set
 *   5. managed   — system-wide org policy file:
 *                    Linux/macOS: `/etc/ailancers/managed-settings.json`
 *                    Windows:     `%PROGRAMDATA%\Ailancers\managed-settings.json`
 *                  (highest priority — for IT-deployed deny rules etc.)
 *
 * Re-reads on demand based on file mtime + watches the workspace-scoped paths
 * so a save propagates without a window reload. Managed + user + cli are
 * outside the workspace, so VS Code's workspace watcher won't see them — we
 * detect changes on every getSettings() call via mtime in `currentKey()`.
 */
export class SettingsLoader implements vscode.Disposable {
  private cache: AilancersSettings | null = null;
  private cacheKey = "";
  private watchers: vscode.FileSystemWatcher[] = [];
  private emitter = new vscode.EventEmitter<AilancersSettings>();
  /** Fires whenever any of the three files changes. */
  readonly onDidChange = this.emitter.event;

  constructor(private outputChannel?: vscode.OutputChannel) {
    this.installWatchers();
  }

  private log(msg: string): void {
    this.outputChannel?.appendLine(`[settings] ${msg}`);
  }

  private candidatePaths(): {
    user: string;
    project?: string;
    local?: string;
    /** $AILANCERS_SETTINGS env override — typically used by automation. */
    cli?: string;
    /** System-wide org policy. Outside the workspace; not user-editable
     *  unless they have admin rights to the path. */
    managed?: string;
  } {
    const user = path.join(os.homedir(), ".ailancers", "settings.json");
    const cli = process.env.AILANCERS_SETTINGS && process.env.AILANCERS_SETTINGS.trim().length > 0
      ? process.env.AILANCERS_SETTINGS
      : undefined;
    const managed = process.platform === "win32"
      ? (process.env.PROGRAMDATA
        ? path.join(process.env.PROGRAMDATA, "Ailancers", "managed-settings.json")
        : undefined)
      : "/etc/ailancers/managed-settings.json";

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return { user, cli, managed };
    const root = folders[0].uri.fsPath;
    return {
      user,
      project: path.join(root, ".ailancers", "settings.json"),
      local: path.join(root, ".ailancers", "settings.local.json"),
      cli,
      managed,
    };
  }

  /** Cheap key built from mtime of every candidate path. */
  private currentKey(): string {
    const { user, project, local, cli, managed } = this.candidatePaths();
    const parts = [user, project, local, cli, managed].map((p) => {
      if (!p) return "-";
      try { return `${p}:${fs.statSync(p).mtimeMs}`; } catch { return `${p}:0`; }
    });
    return parts.join("|");
  }

  private installWatchers(): void {
    for (const w of this.watchers) w.dispose();
    this.watchers = [];

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;
    const root = folders[0].uri;

    // Watch the project + local files (user-level lives outside the workspace
    // so VS Code's workspace watcher won't see it; we re-check via mtime on
    // every getSettings() call instead).
    const w1 = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, ".ailancers/settings.json")
    );
    const w2 = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, ".ailancers/settings.local.json")
    );
    for (const w of [w1, w2]) {
      w.onDidChange(() => this.invalidateAndEmit());
      w.onDidCreate(() => this.invalidateAndEmit());
      w.onDidDelete(() => this.invalidateAndEmit());
      this.watchers.push(w);
    }
  }

  private invalidateAndEmit(): void {
    this.cache = null;
    this.emitter.fire(this.getSettings());
  }

  /** Synchronous accessor — fast path, mtime-cached. */
  getSettings(): AilancersSettings {
    const key = this.currentKey();
    if (this.cache && key === this.cacheKey) return this.cache;
    this.cache = this.loadFresh();
    this.cacheKey = key;
    return this.cache;
  }

  private loadFresh(): AilancersSettings {
    const { user, project, local, cli, managed } = this.candidatePaths();
    const layers: AilancersSettings[] = [];
    // Order matters: lowest priority first. Managed wins on scalars; deny
    // rules are unioned across every scope so managed deny is non-overridable
    // regardless of layer order. `cli` slots between local and managed so
    // automation runs can override project + local but not org policy.
    for (const p of [user, project, local, cli, managed]) {
      if (!p) continue;
      const parsed = this.readOne(p);
      if (parsed) layers.push(parsed);
    }
    return mergeSettings(layers);
  }

  private readOne(filePath: string): AilancersSettings | null {
    let raw: string;
    try { raw = fs.readFileSync(filePath, "utf-8"); } catch { return null; }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        this.log(`Ignoring ${filePath}: not a JSON object`);
        return null;
      }
      return parsed as AilancersSettings;
    } catch (err) {
      // Surface the error so users can fix their JSON, but don't fail-stop —
      // an old conversation should still be usable.
      const message = err instanceof Error ? err.message : String(err);
      this.log(`Failed to parse ${filePath}: ${message}`);
      void vscode.window.showWarningMessage(
        `Ailancers: ${path.basename(filePath)} has invalid JSON — ${message}`,
        "Open file",
      ).then((choice) => {
        if (choice === "Open file") {
          void vscode.window.showTextDocument(vscode.Uri.file(filePath));
        }
      });
      return null;
    }
  }

  dispose(): void {
    for (const w of this.watchers) w.dispose();
    this.emitter.dispose();
  }
}

/**
 * Merge layers from lowest priority to highest. Scalars overwrite; arrays in
 * `permissions.{allow,deny,ask}` are unioned; objects merge by key.
 */
export function mergeSettings(layers: AilancersSettings[]): AilancersSettings {
  const out: AilancersSettings = {};
  for (const layer of layers) {
    if (layer.model !== undefined) out.model = layer.model;
    if (layer.permissions) {
      out.permissions = out.permissions ?? {};
      for (const key of ["allow", "deny", "ask"] as const) {
        const incoming = layer.permissions[key];
        if (!incoming || incoming.length === 0) continue;
        const existing = out.permissions[key] ?? [];
        // De-dupe, preserving first-seen order
        const seen = new Set(existing);
        const merged = [...existing];
        for (const v of incoming) {
          if (!seen.has(v)) { merged.push(v); seen.add(v); }
        }
        out.permissions[key] = merged;
      }
    }
    if (layer.hooks) out.hooks = { ...(out.hooks ?? {}), ...layer.hooks };
    if (layer.mcpServers) out.mcpServers = { ...(out.mcpServers ?? {}), ...layer.mcpServers };
    if (layer.agents) out.agents = layer.agents;
    if (layer.rules) out.rules = layer.rules;
    if (layer.env) out.env = { ...(out.env ?? {}), ...layer.env };
  }
  return out;
}
