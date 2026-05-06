import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ChatService } from "../services/ChatService";
import type { ApiClient } from "../services/ApiClient";
import type { AuthService } from "../services/AuthService";

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  /** Optional callback fired when something needs the user while the chat is
   *  hidden. The wiring code in extension.ts hooks this up to StatusBarProvider. */
  onAttention?: (state: "none" | "pending" | "done") => void;
  /** Fired whenever a stream starts / ends. extension.ts forwards this to
   *  StatusBarProvider.setStreaming so the user sees a `running…` spinner
   *  in the status bar regardless of whether the chat panel is open. */
  onStreaming?: (streaming: boolean) => void;

  /** Lazy-registered virtual file system for `ailancers-proposed:` URIs that
   *  back the `vscode.diff` view. Each proposed doc lives at
   *  `ailancers-proposed:/<random-id>/<filename>` and serves the most-recent
   *  proposed content for that id. We register the provider on first use so
   *  cold paths don't pay for it. */
  private proposedContentProvider: ProposedContentProvider | null = null;
  private getProposedProvider(): ProposedContentProvider {
    if (!this.proposedContentProvider) {
      this.proposedContentProvider = new ProposedContentProvider();
      vscode.workspace.registerTextDocumentContentProvider(
        ProposedContentProvider.scheme,
        this.proposedContentProvider,
      );
    }
    return this.proposedContentProvider;
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly chatService: ChatService,
    private readonly apiClient: ApiClient,
    private readonly authService: AuthService,
    private readonly extensionContext: vscode.ExtensionContext,
  ) {}

  /** globalState key for the persisted onboarding checklist. */
  private static readonly CHECKLIST_KEY = "ailancers.onboarding";

  /** True when the chat panel is visible to the user — used to decide whether
   *  to surface OS toasts (we only ping when the chat is hidden). */
  private isVisible = true;

  /** Disposables held while the view is alive (config listener, etc.). */
  private viewDisposables: vscode.Disposable[] = [];

  /** Context-key publishing helper — `when` clauses in package.json read these. */
  private setContext(key: string, value: unknown): void {
    void vscode.commands.executeCommand("setContext", key, value);
  }

  /** Snapshot the webview-relevant slice of `ailancers.*` config. */
  private readWebviewConfig() {
    const cfg = vscode.workspace.getConfiguration("ailancers");
    const mode = cfg.get<string>("initialPermissionMode", "default");
    return {
      useCtrlEnterToSend: cfg.get<boolean>("useCtrlEnterToSend", false),
      initialPermissionMode: mode === "plan" ? "plan" as const : "default" as const,
      hideOnboarding: cfg.get<boolean>("hideOnboarding", false),
      defaultModelFromSettings: this.settingsLoader?.getSettings().model,
    };
  }

  /** Settings file loader injected by extension.ts after construction. */
  private settingsLoader?: import("../services/SettingsLoader").SettingsLoader;
  setSettingsLoader(loader: import("../services/SettingsLoader").SettingsLoader): void {
    this.settingsLoader = loader;
    // Re-push config + permissions whenever the settings file changes.
    loader.onDidChange(() => this.pushConfig());
  }

  private pushConfig(): void {
    this.postToWebview({ type: "configLoaded", config: this.readWebviewConfig() });
  }

  /** Lightweight snapshot for the input-footer indicator. */
  private pushEditorSnapshot(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
      this.postToWebview({ type: "editorContextSnapshot", snapshot: null });
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    const root = folders?.[0]?.uri.fsPath;
    let activeFile: string;
    if (root && editor.document.uri.fsPath.startsWith(root)) {
      activeFile = path.relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
    } else {
      activeFile = editor.document.uri.fsPath;
    }
    const sel = editor.selection;
    const selectionLines = sel.isEmpty ? undefined : sel.end.line - sel.start.line + 1;
    this.postToWebview({
      type: "editorContextSnapshot",
      snapshot: { activeFile, selectionLines },
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
      ],
    };

    // Preserve scroll/streaming state across panel-toggle events.
    webviewView.webview.html = this.getHtml(webviewView.webview);
    (webviewView as vscode.WebviewView & { retainContextWhenHidden?: boolean }).retainContextWhenHidden = true;

    // Track visibility for the "OS toast when chat is hidden" UX.
    this.isVisible = webviewView.visible;
    this.setContext("ailancersChatFocused", this.isVisible);
    webviewView.onDidChangeVisibility(() => {
      this.isVisible = webviewView.visible;
      this.setContext("ailancersChatFocused", this.isVisible);
      // Coming back into view dismisses any "needs you" / "finished" state.
      if (this.isVisible) this.onAttention?.("none");
    });

    // Push config to the webview when any `ailancers.*` setting changes so
    // ChatInput / App can react live without a reload.
    for (const d of this.viewDisposables) d.dispose();
    this.viewDisposables = [];
    this.viewDisposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("ailancers")) this.pushConfig();
      })
    );
    // Push the editor-context snapshot whenever the active editor or its
    // selection changes. ChatInput renders this as `📎 src/foo.ts (3 lines)`.
    this.viewDisposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.pushEditorSnapshot()),
      vscode.window.onDidChangeTextEditorSelection(() => this.pushEditorSnapshot()),
    );
    // Reload custom slash commands when the user edits anything in
    // `.ailancers/commands/`. Project-scoped only; user-scoped commands
    // (in `~/.ailancers/commands/`) reload on next `getAuthState`.
    const commandsWatcher = vscode.workspace.createFileSystemWatcher(
      "**/.ailancers/commands/*.md",
    );
    this.viewDisposables.push(
      commandsWatcher,
      commandsWatcher.onDidCreate(() => void this.pushCustomCommands()),
      commandsWatcher.onDidChange(() => void this.pushCustomCommands()),
      commandsWatcher.onDidDelete(() => void this.pushCustomCommands()),
    );

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "sendMessage": {
          this.chatService.sendMessage(
            msg.conversationId,
            msg.content,
            (wsMsg) => this.postToWebview(wsMsg),
            msg.model,
            msg.images
          );
          break;
        }
        case "sendAgentMessage": {
          void this.chatService.sendAgentMessage(
            msg.conversationId,
            msg.content,
            (wsMsg) => this.postToWebview(wsMsg),
            {
              model: msg.model,
              agentType: msg.agentType,
              images: msg.images,
              planMode: msg.planMode,
              excludeEditorContext: msg.excludeEditorContext,
              effort: msg.effort,
            }
          );
          break;
        }
        case "loadModels": {
          try {
            const result = await this.apiClient.get<{ models: unknown[]; defaults?: { chatModel: string; codingModel: string } }>("/api/models");
            this.postToWebview({ type: "modelsLoaded", models: result.models, defaults: result.defaults });
          } catch {
            // Models endpoint unavailable — send empty
            this.postToWebview({ type: "modelsLoaded", models: [] });
          }
          break;
        }
        case "toolApprovalResponse": {
          this.chatService.resolveApproval(msg.toolCallId, msg.decision, msg.editedInput);
          break;
        }
        case "cancelStream": {
          this.chatService.cancelStream(msg.conversationId);
          break;
        }
        case "loadConversations": {
          const convs = await this.chatService.getConversations();
          this.postToWebview({ type: "conversations", data: convs });
          break;
        }
        case "newConversation": {
          const conv = await this.chatService.createConversation();
          this.postToWebview({ type: "conversationCreated", data: conv });
          break;
        }
        case "loadMessages": {
          const data = await this.chatService.getConversation(msg.conversationId);
          this.postToWebview({ type: "messagesLoaded", data });
          break;
        }
        case "exportConversation": {
          await this.exportConversation(msg.conversationId, msg.format ?? "markdown");
          break;
        }
        case "login": {
          if (msg.email && msg.password) {
            const result = await this.authService.login(msg.email, msg.password);
            this.postToWebview({ type: "loginResult", success: result.success, error: result.error });
          }
          break;
        }
        case "loginWithBrowser": {
          this.handleBrowserLogin();
          break;
        }
        case "getAuthState": {
          this.postToWebview({
            type: "authState",
            authenticated: this.authService.isAuthenticated,
          });
          // Piggyback on auth-state load: push current config + editor snapshot
          // + custom slash commands so the webview's first render is fully
          // populated.
          this.pushConfig();
          this.pushEditorSnapshot();
          void this.pushCustomCommands();
          break;
        }
        case "loadConfig": {
          this.pushConfig();
          break;
        }
        // ── New webview-initiated commands (Wave 3/4 quick wins) ──
        case "openSettings": {
          await vscode.commands.executeCommand("workbench.action.openSettings", "ailancers");
          break;
        }
        case "openDocs": {
          await vscode.env.openExternal(vscode.Uri.parse("https://ailancers.com/docs"));
          break;
        }
        case "sendFeedback": {
          const url = `https://feedback.ailancers.com/?ext=${encodeURIComponent("0.2.4")}&vscode=${encodeURIComponent(vscode.version)}&platform=${encodeURIComponent(process.platform)}`;
          await vscode.env.openExternal(vscode.Uri.parse(url));
          break;
        }
        case "openFile": {
          // Click on a file-link rendered in chat. Open the workspace-relative
          // path at the requested line. Tries each workspace folder before
          // giving up — supports multi-root layouts roughly correctly.
          await this.openFileFromChat(msg.path as string, msg.line as number | undefined, msg.endLine as number | undefined);
          break;
        }
        case "writeAllowRule": {
          await this.appendAllowRule(msg.rule as string);
          break;
        }
        case "initProjectRules": {
          await this.initProjectRules();
          break;
        }
        case "openPermissionsFile": {
          // Hooks share the same `.ailancers/settings.json` file as
          // permissions (single-file foundation). Reuse the existing command.
          await vscode.commands.executeCommand("ailancers.openPermissions");
          break;
        }
        case "loadFileList": {
          await this.handleFileListRequest(msg.query as string);
          break;
        }
        case "renameConversation": {
          const conversationId = String(msg.conversationId ?? "");
          const title = String(msg.title ?? "").trim();
          if (!conversationId || !title) break;
          try {
            const result = await this.apiClient.patch<{ conversation: { id: string; title: string } }>(
              `/api/chat/conversations/${conversationId}`,
              { title },
            );
            if (result.conversation) {
              this.postToWebview({
                type: "conversationRenamed",
                conversationId: result.conversation.id,
                title: result.conversation.title,
              });
            }
          } catch (err) {
            void vscode.window.showWarningMessage(
              `Couldn't rename conversation: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          break;
        }
        case "compactConversation": {
          // Forward to backend; result is a `{ compacted, summarised, reason }`
          // shape. Webview re-loads messages on receipt.
          const conversationId = String(msg.conversationId ?? "");
          if (!conversationId) break;
          try {
            const result = await this.apiClient.post<{
              compacted: boolean;
              summarised?: number;
              reason?: string;
            }>(`/api/chat/conversations/${conversationId}/compact`);
            this.postToWebview({
              type: "compactResult",
              conversationId,
              compacted: !!result.compacted,
              summarised: result.summarised,
              reason: result.reason,
            });
          } catch (err) {
            this.postToWebview({
              type: "compactResult",
              conversationId,
              compacted: false,
              reason: `Compact failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
          break;
        }
        case "openEditableProposed": {
          // "Edit & approve" path. We open the proposed full-file content
          // as an `untitled:` document (markdown-ish, but typed as the
          // target file's language for syntax highlighting). When the user
          // closes it, the host posts `editableProposedClosed` with the
          // final text — the webview folds that into its approval response.
          const toolCallId = String(msg.toolCallId ?? "");
          if (!toolCallId) break;
          await this.openEditableProposed(toolCallId);
          break;
        }
        case "showProposedDiff": {
          await this.showProposedDiff(
            msg.path as string,
            msg.oldText as string | undefined,
            msg.newText as string | undefined,
            msg.content as string | undefined,
          );
          break;
        }
        case "loadChecklist": {
          const stored = this.extensionContext.globalState.get<{
            completed?: string[];
            dismissed?: boolean;
          }>(ChatViewProvider.CHECKLIST_KEY);
          this.postToWebview({
            type: "checklistLoaded",
            completed: stored?.completed ?? [],
            dismissed: !!stored?.dismissed,
          });
          break;
        }
        case "loadCustomCommands": {
          await this.pushCustomCommands();
          break;
        }
        case "openCustomCommandsFolder": {
          // Project-scoped commands live at `<workspace>/.ailancers/commands/`.
          // If the folder is missing, create it with a starter `review.md`
          // command so users have something to copy/edit. Then open the
          // starter file (or the folder if it already had content).
          const folders = vscode.workspace.workspaceFolders;
          if (!folders || folders.length === 0) {
            void vscode.window.showInformationMessage("Open a folder first to author custom commands.");
            break;
          }
          const dir = path.join(folders[0].uri.fsPath, ".ailancers", "commands");
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
          if (entries.length === 0) {
            const starter = path.join(dir, "review.md");
            fs.writeFileSync(
              starter,
              "---\n" +
              "description: Review code with focus on bugs, security, performance\n" +
              "argHint: <file or area to review>\n" +
              "---\n" +
              "Please do a thorough code review of: $ARGUMENTS\n\n" +
              "Focus on:\n" +
              "- Logic bugs and edge cases\n" +
              "- Security issues\n" +
              "- Performance hotspots\n" +
              "- Readability\n\n" +
              "For each finding, give a file:line reference and a one-line fix suggestion.\n",
              "utf-8",
            );
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(starter));
            await vscode.window.showTextDocument(doc, { preview: false });
            void vscode.window.showInformationMessage(
              "Created `.ailancers/commands/review.md` as a starter. Add more `.md` files here to define your own slash commands. Use `$ARGUMENTS` for arg substitution.",
            );
          } else {
            await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(dir));
          }
          // Refresh the picker so the new file (if any) shows immediately.
          await this.pushCustomCommands();
          break;
        }
        case "saveMemorySuggestion": {
          // Append the model's `<memory_suggestion>` to the personal local
          // rules file, opening it for review. We don't auto-commit — the
          // user gets to decide whether the rule is worth keeping. Idempotent:
          // refuses to append a duplicate suggestion (case-insensitive
          // substring check against the existing file).
          const folders = vscode.workspace.workspaceFolders;
          if (!folders || folders.length === 0) {
            void vscode.window.showInformationMessage("Open a folder first to save memories.");
            break;
          }
          const root = folders[0].uri.fsPath;
          const filePath = path.join(root, ".ailancers", "instructions.local.md");
          const dir = path.dirname(filePath);
          const suggestion = String(msg.suggestion ?? "").trim();
          if (!suggestion) break;
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          let existing = "";
          try { existing = fs.readFileSync(filePath, "utf-8"); } catch { /* missing — fine */ }
          if (existing.toLowerCase().includes(suggestion.toLowerCase())) {
            void vscode.window.showInformationMessage("This memory is already saved.");
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(doc, { preview: false });
            break;
          }
          const banner = existing.trim()
            ? "\n\n"
            : "# Ailancers — your local project rules (gitignored)\n\nThese override / extend the team rules. Don't commit them.\n\n## Personal preferences\n\n";
          const stamp = `<!-- saved ${new Date().toISOString()} -->`;
          const next = existing + banner + `- ${suggestion}\n  ${stamp}\n`;
          fs.writeFileSync(filePath, next, "utf-8");
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
          await vscode.window.showTextDocument(doc, { preview: false });
          break;
        }
        case "setPermissionMode": {
          // Push the unified mode down to ChatService so it can pre-populate
          // the session-auto-approve set for accept-edits / bypass.
          this.chatService.setPermissionMode(msg.mode);
          break;
        }
        case "pickMemoryFile": {
          // Quick-pick the three rules-file scopes:
          //   • user (~/.ailancers/instructions.md)
          //   • project team (.ailancers/instructions.md)
          //   • project local (.ailancers/instructions.local.md)
          // For each, show whether it exists. Picking opens it (creating an
          // empty file with a starter banner if missing).
          await this.pickMemoryFile();
          break;
        }
        case "openAuditLog": {
          // Open `.ailancers/audit.log` in the editor. Created lazily on
          // first decision, so it may not exist yet — show a friendly note.
          const uri = this.chatService.getPermissionAuditLog().getLogUri();
          if (!uri) {
            void vscode.window.showInformationMessage(
              "Open a workspace folder to view the permission audit log.",
            );
            break;
          }
          if (!fs.existsSync(uri.fsPath)) {
            void vscode.window.showInformationMessage(
              "No permission decisions logged yet — the file is created on the first tool call after install.",
            );
            break;
          }
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
          break;
        }
        case "loadFilePreview": {
          // Hover preview for `.file-link` anchors. Returns the first 20
          // lines (or 4KB, whichever is smaller). `content: null` signals
          // the file couldn't be read so the webview shows a graceful
          // "(file unavailable)" placeholder.
          const requestedPath = String(msg.path ?? "");
          if (!requestedPath) {
            this.postToWebview({ type: "filePreview", path: requestedPath, content: null });
            break;
          }
          try {
            const folders = vscode.workspace.workspaceFolders ?? [];
            let absolute: string | null = null;
            if (path.isAbsolute(requestedPath)) {
              absolute = requestedPath;
            } else {
              for (const folder of folders) {
                const candidate = path.join(folder.uri.fsPath, requestedPath);
                if (fs.existsSync(candidate)) {
                  absolute = candidate;
                  break;
                }
              }
            }
            if (!absolute || !fs.existsSync(absolute)) {
              this.postToWebview({ type: "filePreview", path: requestedPath, content: "" });
              break;
            }
            const stat = fs.statSync(absolute);
            if (!stat.isFile() || stat.size > 256 * 1024) {
              this.postToWebview({ type: "filePreview", path: requestedPath, content: "" });
              break;
            }
            const raw = fs.readFileSync(absolute, "utf-8");
            const trimmed = raw.split("\n").slice(0, 20).join("\n").slice(0, 4 * 1024);
            this.postToWebview({ type: "filePreview", path: requestedPath, content: trimmed });
          } catch {
            this.postToWebview({ type: "filePreview", path: requestedPath, content: "" });
          }
          break;
        }
        case "openMarkdownInEditor": {
          // Open assistant message content as a new untitled markdown doc
          // so the user can annotate inline. Used for plan-mode outputs.
          const content = String(msg.content ?? "");
          const doc = await vscode.workspace.openTextDocument({
            language: "markdown",
            content,
          });
          await vscode.window.showTextDocument(doc, { preview: false });
          break;
        }
        case "saveChecklist": {
          await this.extensionContext.globalState.update(
            ChatViewProvider.CHECKLIST_KEY,
            {
              completed: Array.isArray(msg.completed) ? msg.completed : [],
              dismissed: !!msg.dismissed,
            },
          );
          break;
        }
      }
    });
  }

  /**
   * Resolve `@`-autocomplete queries to a ranked list of workspace files.
   * Strategy: VS Code's `findFiles` glob is fast but doesn't fuzzy-match —
   * we ask for `**\/<query>*` to get prefix matches, then sort by name length
   * (shorter = better match) and dedupe. Honours `.gitignore` via `findFiles`'s
   * default exclude. Capped at 30 results so the picker stays snappy.
   */
  private async handleFileListRequest(query: string): Promise<void> {
    const q = (query ?? "").trim().toLowerCase();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.postToWebview({ type: "fileListResult", query, matches: [] });
      return;
    }
    const root = folders[0].uri.fsPath;

    // Include patterns: anywhere under the workspace, name-fuzzy on the query.
    // For empty query, return recently-edited files (rough proxy: just the
    // first 30 matches without filtering).
    const include = q
      ? `**/*${q}*`
      : `**/*`;

    // Use a bigger fetch than we'll show so post-rank filtering has options.
    const uris = await vscode.workspace.findFiles(include, "**/node_modules/**", 200);

    const matches = uris.map((u) => {
      const rel = path.relative(root, u.fsPath).replace(/\\/g, "/");
      const name = path.basename(rel);
      return { path: rel, name };
    });

    // Rank: exact-name match > name starts-with > name contains > path contains.
    // Within each tier, sort by path length ascending.
    const score = (m: { path: string; name: string }) => {
      const lname = m.name.toLowerCase();
      const lpath = m.path.toLowerCase();
      if (lname === q) return 0;
      if (lname.startsWith(q)) return 1;
      if (lname.includes(q)) return 2;
      if (lpath.includes(q)) return 3;
      return 4;
    };
    const ranked = matches
      .sort((a, b) => {
        const sa = score(a);
        const sb = score(b);
        if (sa !== sb) return sa - sb;
        return a.path.length - b.path.length;
      })
      .slice(0, 30);

    this.postToWebview({ type: "fileListResult", query, matches: ranked });
  }

  /**
   * `/init` handler. Reads common project-metadata files and builds a draft
   * prompt asking the AI to write a starter `.ailancers/instructions.md`.
   * Inserts the prompt into the chat input — the user reviews + sends.
   */
  /** `/memory` slash entry — quick-pick all rules / instructions files,
   *  highlighting which exist on disk. Picking opens the file (creating the
   *  local override with a starter comment if missing). */
  /** Scan `.ailancers/commands/*.md` (project-scoped) plus
   *  `~/.ailancers/commands/*.md` (user-scoped) and post the parsed
   *  custom commands to the webview. Project-scoped commands win on name
   *  collision. Tiny YAML-ish frontmatter parser inline so we don't pull
   *  in `js-yaml`. */
  private async pushCustomCommands(): Promise<void> {
    const commands = new Map<string, { name: string; description?: string; argHint?: string; body: string }>();

    const dirs: string[] = [];
    const home = require("node:os").homedir() as string;
    dirs.push(path.join(home, ".ailancers", "commands")); // user-scoped
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders[0]) {
      dirs.push(path.join(folders[0].uri.fsPath, ".ailancers", "commands")); // project-scoped wins
    }

    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = await fs.promises.readdir(dir);
      } catch {
        continue; // missing dir — fine
      }
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const name = entry.slice(0, -3);
        if (!/^[a-z0-9_-]+$/i.test(name)) continue; // safety: no path-like names
        try {
          const raw = await fs.promises.readFile(path.join(dir, entry), "utf-8");
          const parsed = parseCommandFrontmatter(raw);
          commands.set(name, {
            name,
            description: parsed.description,
            argHint: parsed.argHint,
            body: parsed.body,
          });
        } catch { /* skip unreadable */ }
      }
    }

    this.postToWebview({ type: "customCommandsLoaded", commands: Array.from(commands.values()) });
  }

  private async pickMemoryFile(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const projectRoot = folders?.[0]?.uri.fsPath;
    const home = require("node:os").homedir() as string;
    const userRulesPath = path.join(home, ".ailancers", "instructions.md");
    const teamRulesPath = projectRoot ? path.join(projectRoot, ".ailancers", "instructions.md") : null;
    const localRulesPath = projectRoot ? path.join(projectRoot, ".ailancers", "instructions.local.md") : null;

    interface MemoryPickItem extends vscode.QuickPickItem {
      scope: "user" | "team" | "local";
      absolute: string;
    }
    const items: MemoryPickItem[] = [];

    items.push({
      label: "$(account) User rules",
      description: fs.existsSync(userRulesPath) ? "exists" : "create",
      detail: userRulesPath,
      scope: "user",
      absolute: userRulesPath,
    });
    if (teamRulesPath) {
      items.push({
        label: "$(repo) Project (team) rules",
        description: fs.existsSync(teamRulesPath) ? "exists — committed" : "create",
        detail: teamRulesPath,
        scope: "team",
        absolute: teamRulesPath,
      });
    }
    if (localRulesPath) {
      items.push({
        label: "$(person) Project (your local) rules",
        description: fs.existsSync(localRulesPath) ? "exists — gitignored" : "create",
        detail: localRulesPath,
        scope: "local",
        absolute: localRulesPath,
      });
    }

    const picked = await vscode.window.showQuickPick<MemoryPickItem>(items, {
      title: "Ailancers Memory — pick a rules file",
      placeHolder: "Files load top-down: User → Project (team) → Project (local). Project rules override user rules.",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;

    const target = picked.absolute;
    if (!fs.existsSync(target)) {
      // Create with a small starter banner so empty files don't look broken.
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const banner =
        picked.scope === "user"
          ? "# Ailancers — user rules\n\nThese rules apply across every project you open.\nKeep them lean — Anthropic caches the system prompt prefix per session.\n\n## Coding style\n\n- \n"
          : picked.scope === "team"
            ? "# Ailancers — project rules (committed)\n\nThese rules apply to everyone on this project.\nKeep them concise; verbose rules get ignored.\n\n## Stack\n\n- \n\n## Conventions\n\n- \n"
            : "# Ailancers — your local project rules (gitignored)\n\nThese override / extend the team rules. Don't commit them.\n\n## Personal preferences\n\n- \n";
      fs.writeFileSync(target, banner, "utf-8");
    }

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private async initProjectRules(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage("Open a folder first to use /init.");
      return;
    }
    const root = folders[0].uri.fsPath;

    // Read metadata files. Each is best-effort; missing is fine. Cap each
    // file at ~4KB so we don't blow the prompt.
    const probes: { rel: string; cap: number }[] = [
      { rel: "package.json", cap: 4000 },
      { rel: "pyproject.toml", cap: 4000 },
      { rel: "Cargo.toml", cap: 4000 },
      { rel: "go.mod", cap: 2000 },
      { rel: "Gemfile", cap: 2000 },
      { rel: "composer.json", cap: 2000 },
      { rel: "tsconfig.json", cap: 2000 },
      { rel: "README.md", cap: 6000 },
      { rel: "CLAUDE.md", cap: 4000 },
      { rel: ".github/copilot-instructions.md", cap: 4000 },
    ];
    const readFile = async (rel: string, cap: number): Promise<string | null> => {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(root, rel)));
        const content = Buffer.from(bytes).toString("utf-8");
        return content.length > cap ? content.slice(0, cap) + "\n…(truncated)" : content;
      } catch {
        return null;
      }
    };

    const sections: string[] = [];
    for (const p of probes) {
      const content = await readFile(p.rel, p.cap);
      if (content !== null) {
        sections.push(`### ${p.rel}\n\n\`\`\`\n${content}\n\`\`\`\n`);
      }
    }

    if (sections.length === 0) {
      this.postToWebview({
        type: "insertAtCursor",
        text:
          "Help me write a starter .ailancers/instructions.md for this repo.\n\n" +
          "(Note: I couldn't find any standard metadata files — tell me about your project " +
          "and I'll draft a rules file.)\n",
      });
      return;
    }

    const prompt =
      "Help me write a starter `.ailancers/instructions.md` file for this project. " +
      "These rules get auto-injected into every agent message, so they should capture the " +
      "*non-obvious* stuff: build/test commands, branching conventions, code-style preferences, " +
      "what to avoid.\n\n" +
      "Based on the metadata below, draft a concise instructions.md (under 100 lines) that:\n" +
      "- Names the project + one-line summary\n" +
      "- Lists the actual commands to build / test / lint / dev\n" +
      "- Calls out any code style, naming, or testing conventions that aren't obvious\n" +
      "- Flags directories the agent should avoid editing\n" +
      "- Skips anything that's already obvious from reading the source (no boilerplate, no fluff)\n\n" +
      "When done, propose to write the file via `write_file` to `.ailancers/instructions.md`. " +
      "I'll review your draft before approving.\n\n" +
      "## Project metadata\n\n" +
      sections.join("\n");

    this.postToWebview({ type: "insertAtCursor", text: prompt });
  }

  /**
   * Append a `Tool(specifier)` string to `permissions.allow` in the project
   * settings file. Creates `.ailancers/` and the file if missing. Idempotent:
   * a duplicate rule is silently skipped.
   */
  private async appendAllowRule(rule: string): Promise<void> {
    if (!rule || typeof rule !== "string") return;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      void vscode.window.showWarningMessage("Open a folder first to save permission rules.");
      return;
    }
    const root = folders[0].uri.fsPath;
    const dir = path.join(root, ".ailancers");
    const file = path.join(dir, "settings.json");
    const fsp = await import("node:fs/promises");
    try {
      await fsp.mkdir(dir, { recursive: true });
      // Read existing or start fresh
      let parsed: { permissions?: { allow?: string[] } } = {};
      try {
        const raw = await fsp.readFile(file, "utf-8");
        parsed = JSON.parse(raw);
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e?.code !== "ENOENT") {
          // Existing but unparseable — refuse to clobber
          void vscode.window.showErrorMessage(
            "Ailancers: .ailancers/settings.json has invalid JSON; fix it before adding rules.",
            "Open file",
          ).then((choice) => {
            if (choice === "Open file") {
              void vscode.window.showTextDocument(vscode.Uri.file(file));
            }
          });
          return;
        }
      }
      parsed.permissions = parsed.permissions ?? {};
      parsed.permissions.allow = parsed.permissions.allow ?? [];
      if (!parsed.permissions.allow.includes(rule)) {
        parsed.permissions.allow.push(rule);
      }
      await fsp.writeFile(file, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      void vscode.window.showInformationMessage(
        `Ailancers: added ${rule} to .ailancers/settings.json`,
        "Open file",
      ).then((choice) => {
        if (choice === "Open file") {
          void vscode.window.showTextDocument(vscode.Uri.file(file));
        }
      });
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Ailancers: failed to write rule — ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Public so the extension's `cancelStream` command can forward Esc cleanly. */
  cancelActiveStream(): void {
    // We don't track which conversation is active here; the webview is the
    // owner of that state. Ask it to issue a cancel for whatever it considers
    // current.
    this.postToWebview({ type: "requestCancel" });
  }

  /** Public so the host extension can fire a focus shortcut (Cmd/Ctrl+Esc). */
  async focusInput(): Promise<void> {
    if (this.view) {
      this.view.show?.(true);
    } else {
      // View hasn't been resolved yet — open the sidebar then the view.
      await vscode.commands.executeCommand("workbench.view.extension.ailancers-sidebar");
    }
    this.postToWebview({ type: "focusInput" });
  }

  /** Insert arbitrary text into the chat input at the cursor. Opens the panel
   *  if it isn't already showing. */
  async insertText(text: string): Promise<void> {
    if (this.view) this.view.show?.(true);
    this.postToWebview({ type: "insertAtCursor", text });
  }

  /** Insert `@<rel-path>#L<start>-L<end>` at cursor in the input. */
  async insertFileReferenceFromActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("Open a file first to insert a reference.");
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    const root = folders?.[0]?.uri.fsPath;
    let relPath: string;
    if (root && editor.document.uri.fsPath.startsWith(root)) {
      relPath = path.relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
    } else {
      relPath = editor.document.uri.fsPath;
    }
    const sel = editor.selection;
    let suffix = "";
    if (!sel.isEmpty) {
      const start = sel.start.line + 1;
      const end = sel.end.line + 1;
      suffix = start === end ? `#L${start}` : `#L${start}-L${end}`;
    }
    const reference = `@${relPath}${suffix} `;
    if (this.view) this.view.show?.(true);
    this.postToWebview({ type: "insertAtCursor", text: reference });
  }

  /**
   * Notify the user when a permission prompt arrived while the chat was hidden.
   * Caller (ChatService) decides when this is appropriate.
   */
  async maybeNotifyHiddenPermission(toolName: string): Promise<void> {
    if (this.isVisible) return;
    const setting = vscode.workspace
      .getConfiguration("ailancers")
      .get<string>("notifications.permissionRequest", "auto");
    if (setting === "never") return;
    // "auto" only fires when hidden (which we just checked); "always" also fires.
    const choice = await vscode.window.showInformationMessage(
      `Ailancers: agent needs permission to run ${toolName}`,
      "Open chat",
    );
    if (choice === "Open chat") {
      this.view?.show?.(true);
    }
  }

  /**
   * Open VS Code's native side-by-side diff editor showing the proposed edit
   * (`right`) against the current file content (`left`). Read-only preview —
   * users still Allow/Deny in the chat. For new files (`write_file` on a path
   * that doesn't exist) the left side is an empty virtual doc.
   *
   * For `edit_file`: we only have `old_text`/`new_text` (a fragment), not the
   * full file. We compute a synthetic "proposed full file" by replacing the
   * matched span in the on-disk content with `new_text`. If the disk content
   * doesn't match `old_text` (rare race), we fall back to showing the bare
   * find-vs-replace pair.
   */
  /**
   * "Edit & approve" workflow. Looks up the original tool input via
   * ChatService, computes the proposed full-file content (same shape as
   * showProposedDiff), opens it as an untitled markdown-or-original-language
   * doc, and watches for the doc to close. When it closes, posts the final
   * text back to the webview as `editableProposedClosed`. The webview
   * dispatches an approval response carrying the edited content.
   */
  private async openEditableProposed(toolCallId: string): Promise<void> {
    const input = this.chatService.getPendingApprovalInput(toolCallId);
    if (!input) {
      void vscode.window.showInformationMessage("That approval is no longer pending.");
      return;
    }
    const rawPath = String(input.path ?? "");
    const folders = vscode.workspace.workspaceFolders;
    const root = folders?.[0]?.uri.fsPath;
    const absPath = path.isAbsolute(rawPath) ? rawPath : (root ? path.join(root, rawPath) : rawPath);
    let originalContent = "";
    try { originalContent = (await fs.promises.readFile(absPath, "utf-8")).toString(); } catch { /* new file */ }

    let proposed: string;
    if (typeof input.content === "string") {
      proposed = input.content;
    } else if (typeof input.old_text === "string" && typeof input.new_text === "string") {
      proposed = originalContent.includes(input.old_text)
        ? originalContent.replace(input.old_text, input.new_text)
        : input.new_text;
    } else {
      void vscode.window.showWarningMessage("This tool can't be edited before approval.");
      return;
    }

    // Pick a language id from the path extension so syntax highlighting
    // works in the untitled doc. Falls back to plaintext.
    const ext = path.extname(absPath).toLowerCase().replace(/^\./, "");
    const langByExt: Record<string, string> = {
      ts: "typescript", tsx: "typescriptreact",
      js: "javascript", jsx: "javascriptreact",
      json: "json", jsonc: "jsonc",
      md: "markdown", mdx: "markdown",
      css: "css", scss: "scss", html: "html",
      py: "python", rb: "ruby", go: "go", rs: "rust",
      java: "java", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
      sh: "shellscript", yml: "yaml", yaml: "yaml", toml: "toml",
      sql: "sql",
    };
    const language = langByExt[ext] ?? "plaintext";

    const doc = await vscode.workspace.openTextDocument({ content: proposed, language });
    await vscode.window.showTextDocument(doc, { preview: false });
    void vscode.window.showInformationMessage(
      "Edit the proposed content, then close this tab to apply your changes. Closing without changes uses the agent's original proposal.",
    );

    // Watch the document for close. We can't subscribe to a per-doc event,
    // so listen on `onDidCloseTextDocument` and filter by uri.
    const sub = vscode.workspace.onDidCloseTextDocument((closed) => {
      if (closed.uri.toString() !== doc.uri.toString()) return;
      sub.dispose();
      const finalText = doc.getText();
      this.postToWebview({
        type: "editableProposedClosed",
        toolCallId,
        editedContent: finalText,
      });
    });
    this.viewDisposables.push(sub);
  }

  private async showProposedDiff(
    rawPath: string,
    oldText: string | undefined,
    newText: string | undefined,
    content: string | undefined,
  ): Promise<void> {
    if (!rawPath) return;
    const folders = vscode.workspace.workspaceFolders;
    const root = folders?.[0]?.uri.fsPath;
    const absPath = path.isAbsolute(rawPath) ? rawPath : (root ? path.join(root, rawPath) : rawPath);
    const filename = path.basename(absPath);
    const provider = this.getProposedProvider();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Existing on-disk content (may not exist for write_file on a new file)
    let originalContent = "";
    let originalExists = false;
    try {
      originalContent = (await fs.promises.readFile(absPath, "utf-8")).toString();
      originalExists = true;
    } catch {
      // file doesn't exist — fine for write_file
    }

    // Compute the proposed full-file content based on which call shape we got
    let proposedContent: string;
    if (typeof content === "string") {
      // write_file: the entire new file
      proposedContent = content;
    } else if (typeof oldText === "string" && typeof newText === "string") {
      // edit_file: synthesise the proposed full file
      if (originalExists && originalContent.includes(oldText)) {
        proposedContent = originalContent.replace(oldText, newText);
      } else {
        // Fallback: just show the bare find-vs-replace pair so the diff still
        // tells the user something useful.
        originalContent = oldText;
        proposedContent = newText;
      }
    } else {
      vscode.window.showWarningMessage("Ailancers: missing proposed content for diff view.");
      return;
    }

    // Stash both sides in our virtual provider, then ask VS Code to diff them
    const leftUri = vscode.Uri.parse(`${ProposedContentProvider.scheme}:/original/${id}/${encodeURIComponent(filename)}`);
    const rightUri = vscode.Uri.parse(`${ProposedContentProvider.scheme}:/proposed/${id}/${encodeURIComponent(filename)}`);
    provider.set(leftUri.path, originalContent);
    provider.set(rightUri.path, proposedContent);

    const title = `${filename} — proposed by Ailancers`;
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      title,
      { preview: true, preserveFocus: false },
    );
  }

  private async openFileFromChat(rawPath: string, line?: number, endLine?: number): Promise<void> {
    if (!rawPath) return;
    const candidates: string[] = [];
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (path.isAbsolute(rawPath)) {
      candidates.push(rawPath);
    } else {
      for (const f of folders) candidates.push(path.join(f.uri.fsPath, rawPath));
      // Fallback: relative to active editor's directory in no-folder mode
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.scheme === "file") {
        candidates.push(path.join(path.dirname(editor.document.uri.fsPath), rawPath));
      }
    }
    for (const candidate of candidates) {
      try {
        await fs.promises.access(candidate, fs.constants.F_OK);
        const uri = vscode.Uri.file(candidate);
        const doc = await vscode.workspace.openTextDocument(uri);
        const start = Math.max(0, (line ?? 1) - 1);
        const end = Math.max(start, (endLine ?? line ?? 1) - 1);
        await vscode.window.showTextDocument(doc, {
          selection: new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER),
          preview: true,
        });
        return;
      } catch {
        // try next candidate
      }
    }
    vscode.window.showWarningMessage(`Ailancers: file not found — ${rawPath}`);
  }

  refresh(): void {
    if (this.view) {
      this.postToWebview({
        type: "authState",
        authenticated: this.authService.isAuthenticated,
      });
    }
  }

  private postToWebview(message: unknown): void {
    // Tap into the outbound stream to drive the "Ailancers needs you" /
    // "Ailancers finished" status-bar indicator (only when the chat is
    // hidden) and the live `running…` spinner (always).
    if (message && typeof message === "object") {
      const m = message as { type?: string; toolName?: string };
      if (m.type === "stream_start") {
        this.onStreaming?.(true);
      } else if (
        m.type === "agent_complete" ||
        m.type === "stream_end" ||
        m.type === "billing_suspended" ||
        m.type === "error"
      ) {
        this.onStreaming?.(false);
      }
      if (!this.isVisible) {
        if (m.type === "tool_approval_request") {
          this.onAttention?.("pending");
          // Also fire an OS-level toast (gated by `notifications.permissionRequest`)
          void this.maybeNotifyHiddenPermission(m.toolName ?? "tool");
        } else if (
          m.type === "agent_complete" ||
          m.type === "stream_end" ||
          m.type === "billing_suspended"
        ) {
          this.onAttention?.("done");
        }
      }
    }
    this.view?.webview.postMessage(message);
  }

  private async exportConversation(conversationId: string, format: "markdown" | "json"): Promise<void> {
    try {
      // Fetch the export from the backend
      const ext = format === "json" ? "json" : "md";
      const resp = await this.apiClient.fetch(`/api/chat/conversations/${conversationId}/export?format=${format}`);
      if (!resp.ok) {
        vscode.window.showErrorMessage(`Export failed: ${resp.status} ${resp.statusText}`);
        return;
      }
      const text = await resp.text();

      // Suggest a filename pulled from the Content-Disposition header
      const cd = resp.headers.get("Content-Disposition") ?? "";
      const fileMatch = /filename="([^"]+)"/.exec(cd);
      const defaultName = fileMatch?.[1] ?? `ailancers-conversation.${ext}`;

      // VS Code save dialog — much better UX than browser blob downloads
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "", defaultName)),
        filters: format === "json" ? { "JSON": ["json"] } : { "Markdown": ["md"] },
        saveLabel: "Export conversation",
      });
      if (!saveUri) return; // user cancelled

      await fs.promises.writeFile(saveUri.fsPath, text, "utf-8");
      const choice = await vscode.window.showInformationMessage(
        `Exported to ${path.basename(saveUri.fsPath)}`,
        "Open file",
        "Show in Explorer",
      );
      if (choice === "Open file") {
        await vscode.window.showTextDocument(saveUri);
      } else if (choice === "Show in Explorer") {
        await vscode.commands.executeCommand("revealFileInOS", saveUri);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleBrowserLogin(): Promise<void> {
    const serverUrl = this.authService.getServerUrl();
    try {
      // Step 1: Get device code
      const codeResp = await fetch(`${serverUrl}/api/auth/device-code`, { method: "POST" });
      if (!codeResp.ok) {
        this.postToWebview({ type: "loginResult", success: false, error: "Failed to get login code" });
        return;
      }
      const { code } = await codeResp.json() as { code: string };

      // Step 2: Open browser
      vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/auth-bridge?code=${code}`));

      // Step 3: Poll for completion
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const pollResp = await fetch(`${serverUrl}/api/auth/device-code/poll?code=${code}`);
          if (!pollResp.ok) continue;
          const poll = await pollResp.json() as { status: string; accessToken?: string; platformToken?: string; user?: { fullName?: string } };
          if (poll.status === "complete" && (poll.platformToken || poll.accessToken)) {
            // Store the platform token (needed for project fetching from staging-backend)
            await this.authService.loginWithPlatformToken(poll.platformToken || poll.accessToken!);
            this.postToWebview({ type: "loginResult", success: true });
            return;
          }
          if (poll.status === "expired") {
            this.postToWebview({ type: "loginResult", success: false, error: "Login expired. Try again." });
            return;
          }
        } catch { /* retry */ }
      }
      this.postToWebview({ type: "loginResult", success: false, error: "Login timed out" });
    } catch (err) {
      this.postToWebview({ type: "loginResult", success: false, error: err instanceof Error ? err.message : "Browser login failed" });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const distPath = path.join(this.extensionUri.fsPath, "dist", "webview");
    const assetsDir = path.join(distPath, "assets");

    let jsFile = "index.js";
    let cssFile = "index.css";

    try {
      const files = fs.readdirSync(assetsDir);
      jsFile = files.find((f) => f.endsWith(".js")) ?? jsFile;
      cssFile = files.find((f) => f.endsWith(".css")) ?? cssFile;
    } catch {
      // Assets dir may not exist yet during development
    }

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", jsFile)
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", cssFile)
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/**
 * Parse the optional frontmatter on a `.ailancers/commands/<name>.md` file.
 * Recognised keys: `description`, `argHint`. Anything else is ignored.
 * Returns `{ description?, argHint?, body }` where `body` is everything
 * after the closing `---`. No frontmatter ⇒ body is the whole file.
 */
function parseCommandFrontmatter(raw: string): { description?: string; argHint?: string; body: string } {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!fmMatch) return { body: raw.trim() };
  const fmBlock = fmMatch[1];
  const body = fmMatch[2].trim();
  const out: { description?: string; argHint?: string; body: string } = { body };
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = /^(description|argHint)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase() as "description" | "arghint";
    const value = m[2].replace(/^["']|["']$/g, "");
    if (key === "description") out.description = value;
    if (key === "arghint") out.argHint = value;
  }
  return out;
}

/**
 * In-memory `TextDocumentContentProvider` for the `ailancers-proposed:` URI
 * scheme. Keys are the URI's `path` portion; values are the cached content
 * served when VS Code opens the diff editor. Entries persist for the lifetime
 * of the extension activation — small enough that we don't bother evicting.
 */
class ProposedContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "ailancers-proposed";
  private store = new Map<string, string>();
  private emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  set(uriPath: string, content: string): void {
    this.store.set(uriPath, content);
    // Fire change so any open diff editor refreshes if we update mid-session.
    this.emitter.fire(vscode.Uri.parse(`${ProposedContentProvider.scheme}:${uriPath}`));
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.store.get(uri.path) ?? "";
  }
}
