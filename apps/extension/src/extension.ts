import * as vscode from "vscode";
import { AuthService } from "./services/AuthService";
import { ApiClient } from "./services/ApiClient";
import { WebSocketClient } from "./services/WebSocketClient";
import { ChatService } from "./services/ChatService";
import { ToolExecutor } from "./services/ToolExecutor";
import { SettingsLoader } from "./services/SettingsLoader";
import { HookRunner } from "./services/HookRunner";
import { ActivityTracker } from "./services/ActivityTracker";
import { TelemetryService } from "./services/TelemetryService";
import { ScreenCaptureService } from "./services/ScreenCaptureService";
import { HourlyBillingTracker } from "./services/HourlyBillingTracker";
import { SystemIdleService } from "./services/SystemIdleService";
import { AutoStartService } from "./services/AutoStartService";
import { ProjectPickerService } from "./services/ProjectPickerService";
import { WorkspaceContextService } from "./services/WorkspaceContextService";
import { CommitMessageService } from "./services/CommitMessageService";
import { ChatViewProvider } from "./providers/ChatViewProvider";
import { StatusBarProvider } from "./providers/StatusBarProvider";
import { ActivityDashboardProvider } from "./providers/ActivityDashboardProvider";
import { AilancersCodeActionProvider } from "./providers/AilancersCodeActionProvider";

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Ailancers Code");
  const log = (msg: string) => outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);

  log("Activating Ailancers Code extension...");

  // Expose output channel globally for debug logging in services
  (globalThis as Record<string, unknown>).__ailancersOutput = outputChannel;

  // Migration: auto-update stale serverUrl from old Railway domain to new production domain
  const cfg = vscode.workspace.getConfiguration("ailancers");
  const currentUrl = cfg.get<string>("serverUrl");
  if (currentUrl && currentUrl.includes("exten-production.up.railway.app")) {
    await cfg.update("serverUrl", "https://apivscode.ailancers.com", vscode.ConfigurationTarget.Global);
    log("Migrated serverUrl from old Railway domain to apivscode.ailancers.com");
  }

  // Initialize services
  const authService = new AuthService(context.secrets);
  const apiClient = new ApiClient(authService);
  const wsClient = new WebSocketClient(authService);
  const toolExecutor = new ToolExecutor(outputChannel, apiClient);
  const settingsLoader = new SettingsLoader(outputChannel);
  context.subscriptions.push(settingsLoader);
  const hookRunner = new HookRunner(outputChannel);
  const chatService = new ChatService(apiClient, wsClient, toolExecutor);
  chatService.setSettingsLoader(settingsLoader);
  chatService.setHookRunner(hookRunner);
  const workspaceContext = new WorkspaceContextService();
  chatService.setWorkspaceContext(workspaceContext);
  const systemIdleService = new SystemIdleService();
  systemIdleService.start();
  const activityTracker = new ActivityTracker(systemIdleService);
  const projectPicker = new ProjectPickerService(authService, context);
  chatService.setProjectPicker(projectPicker);
  const telemetryService = new TelemetryService(apiClient, activityTracker, projectPicker);
  const screenCaptureService = new ScreenCaptureService(
    context,
    apiClient,
    activityTracker,
    () => authService.isAuthenticated,
  );
  const hourlyBillingTracker = new HourlyBillingTracker(
    context,
    apiClient,
    authService,
    projectPicker,
    activityTracker,
  );
  const autoStartService = new AutoStartService(context);

  // Register sidebar webview
  const chatViewProvider = new ChatViewProvider(context.extensionUri, chatService, apiClient, authService, context);
  chatViewProvider.setSettingsLoader(settingsLoader);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("ailancers.chatView", chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Activity dashboard provider
  const activityDashboard = new ActivityDashboardProvider(context.extensionUri, apiClient, activityTracker);

  // Register status bar (now includes project picker + hourly tracker state)
  const statusBar = new StatusBarProvider(
    authService,
    activityTracker,
    projectPicker,
    hourlyBillingTracker,
  );
  context.subscriptions.push(statusBar, projectPicker);

  // When something needs the user while the chat is hidden, light up the
  // status-bar attention indicator. Cleared when the chat is brought back.
  chatViewProvider.onAttention = (state) => statusBar.setAttention(state);
  chatViewProvider.onStreaming = (streaming) => statusBar.setStreaming(streaming);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("ailancers.login", async () => {
      // Open the Ailancers sidebar + focus the chat view so the LoginScreen
      // (with the proper "Login with Ailancers" browser flow) renders.
      // promptLogin() with raw VS Code input boxes is the legacy fallback —
      // most users never have to see it now.
      await vscode.commands.executeCommand("workbench.view.extension.ailancers-sidebar");
      await vscode.commands.executeCommand("ailancers.chatView.focus");
    }),
    vscode.commands.registerCommand("ailancers.legacyEmailLogin", () => authService.promptLogin()),
    vscode.commands.registerCommand("ailancers.logout", async () => {
      await authService.logout();
      projectPicker.clearSelection();
      projectPicker.invalidateCache();
      vscode.window.showInformationMessage("Ailancers: Logged out successfully");
    }),
    vscode.commands.registerCommand("ailancers.openChat", () => {
      vscode.commands.executeCommand("ailancers.chatView.focus");
    }),
    vscode.commands.registerCommand("ailancers.toggleTracking", () => {
      const config = vscode.workspace.getConfiguration("ailancers");
      const current = config.get<boolean>("trackingEnabled", true);
      config.update("trackingEnabled", !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Ailancers: Tracking ${!current ? "enabled" : "disabled"}`);
    }),
    vscode.commands.registerCommand("ailancers.newConversation", async () => {
      await chatService.createConversation();
      chatViewProvider.refresh();
    }),
    vscode.commands.registerCommand("ailancers.captureScreen", async () => {
      const result = await screenCaptureService.captureNow();
      if (result) {
        vscode.window.showInformationMessage("Ailancers: Screenshot captured");
      } else {
        vscode.window.showWarningMessage("Ailancers: Screenshot capture failed — ensure a session is active");
      }
    }),
    vscode.commands.registerCommand("ailancers.openActivityDashboard", () => {
      activityDashboard.show();
    }),
    // New command: select which project/task to work on
    vscode.commands.registerCommand("ailancers.selectProject", async () => {
      if (!authService.isAuthenticated) {
        vscode.window.showWarningMessage("Sign in to Ailancers first");
        return;
      }
      await projectPicker.promptPicker();
    }),
    // Refresh project list from server (hard refresh, skip cache)
    vscode.commands.registerCommand("ailancers.refreshProjects", async () => {
      projectPicker.invalidateCache();
      log("Refreshing projects (cache cleared)...");
      const projects = await projectPicker.fetchProjects();
      const msg = `Ailancers: Refreshed — ${projects.length} project${projects.length !== 1 ? "s" : ""} found`;
      log(msg);
      if (projects.length === 0) {
        // Show output channel so user can see debug info
        outputChannel.show(true);
      }
      vscode.window.showInformationMessage(msg);
    }),
    // Toggle auto-start on boot
    vscode.commands.registerCommand("ailancers.toggleAutoStart", async () => {
      try {
        if (autoStartService.isEnabled()) {
          await autoStartService.disable();
          vscode.window.showInformationMessage("Ailancers: Auto-start disabled. VS Code will no longer open on boot.");
        } else {
          await autoStartService.enable();
          vscode.window.showInformationMessage("Ailancers: Auto-start enabled. VS Code will open automatically on boot.");
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Ailancers: ${err instanceof Error ? err.message : err}`);
      }
    }),

    // ── New keybinding-bound + Cmd-Palette commands (Wave 4) ──

    // Cmd/Ctrl+Esc — focus the chat input from anywhere
    vscode.commands.registerCommand("ailancers.focusInput", async () => {
      await chatViewProvider.focusInput();
    }),

    // Esc while chat focused + streaming — fire cancel via the webview
    vscode.commands.registerCommand("ailancers.stopGeneration", () => {
      chatViewProvider.cancelActiveStream();
    }),

    // Alt+K from the editor — insert `@file#L5-L10` at the chat input cursor
    vscode.commands.registerCommand("ailancers.insertFileReference", async () => {
      await chatViewProvider.insertFileReferenceFromActiveEditor();
    }),

    // editor/context entry — sends current selection to chat with a preset prompt
    vscode.commands.registerCommand("ailancers.askAilancersAboutSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Open a file first.");
        return;
      }
      await chatViewProvider.focusInput();
      const sel = editor.selection;
      const code = sel.isEmpty ? editor.document.getText() : editor.document.getText(sel);
      const folders = vscode.workspace.workspaceFolders;
      const root = folders?.[0]?.uri.fsPath;
      const relPath = root && editor.document.uri.fsPath.startsWith(root)
        ? require("node:path").relative(root, editor.document.uri.fsPath).replace(/\\/g, "/")
        : editor.document.uri.fsPath;
      const langId = editor.document.languageId;
      const prompt = `Explain this code from ${relPath}:\n\n\`\`\`${langId}\n${code.slice(0, 8000)}\n\`\`\``;
      // Tell webview to prefill the input with this prompt — re-uses the
      // existing edit-and-resend prefill mechanism.
      chatViewProvider.refresh();
      // We don't have a direct "prefill" route yet; pipe via insertAtCursor.
      // The webview's ChatInput interprets it as "set the textarea value".
      void vscode.commands.executeCommand("ailancers.chatView.focus");
      await new Promise((r) => setTimeout(r, 100));
      // Use the insertAtCursor channel; ChatInput appends rather than replaces,
      // but for an empty input the result is the same.
      // (A dedicated `prefillInput` could be added later if appending feels wrong.)
      // postToWebview is private; route through the focusInput method which
      // already calls show() — then send the message.
      // Simpler: directly use the chatViewProvider's insert helper.
      await chatViewProvider.insertText(prompt);
    }),

    // SCM commit message generation — reads `git diff --cached` via the
    // built-in Git extension API, asks the backend for a Conventional-Commits
    // -style message, writes it into the SCM input box. Wired to the SCM
    // title-bar button via the `scm/title` menu in package.json.
    vscode.commands.registerCommand("ailancers.generateCommitMessage", async () => {
      const svc = new CommitMessageService(apiClient);
      await svc.generate();
    }),

    // CodeActionProvider quick-fix entry point. Wired by
    // AilancersCodeActionProvider to every diagnostic; clicking the quick-fix
    // sends a synthetic chat message asking the agent to fix the problem.
    vscode.commands.registerCommand("ailancers.fixWithAilancers", async (
      args: {
        uri: string;
        diagnostic: {
          message: string;
          severity: number;
          code?: string;
          source?: string;
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
        };
      },
    ) => {
      try {
        const docUri = vscode.Uri.parse(args.uri);
        const doc = await vscode.workspace.openTextDocument(docUri);
        // Pull a small context window: the diagnostic line + 8 lines before
        // and after. Caps at 200 lines just in case the diagnostic spans a
        // huge range.
        const startLine = Math.max(0, args.diagnostic.range.start.line - 8);
        const endLine = Math.min(
          doc.lineCount - 1,
          args.diagnostic.range.end.line + 8,
        );
        const lines: string[] = [];
        for (let i = startLine; i <= endLine && lines.length < 200; i++) {
          lines.push(`${i + 1}\t${doc.lineAt(i).text}`);
        }
        const folders = vscode.workspace.workspaceFolders;
        const root = folders?.[0]?.uri.fsPath;
        const relPath = root && docUri.fsPath.startsWith(root)
          ? require("node:path").relative(root, docUri.fsPath).replace(/\\/g, "/")
          : docUri.fsPath;
        const sevLabel = args.diagnostic.severity === vscode.DiagnosticSeverity.Error ? "error"
          : args.diagnostic.severity === vscode.DiagnosticSeverity.Warning ? "warning"
          : args.diagnostic.severity === vscode.DiagnosticSeverity.Information ? "info"
          : "hint";
        const codeStr = args.diagnostic.code ? ` [${args.diagnostic.code}]` : "";
        const sourceStr = args.diagnostic.source ? ` (${args.diagnostic.source})` : "";
        const prompt =
          `Fix this ${sevLabel}${sourceStr}${codeStr} in \`${relPath}\` at line ${args.diagnostic.range.start.line + 1}:\n\n` +
          `> ${args.diagnostic.message.replace(/\n/g, "\n> ")}\n\n` +
          `Surrounding code:\n\n\`\`\`${doc.languageId}\n${lines.join("\n")}\n\`\`\``;
        await chatViewProvider.focusInput();
        await chatViewProvider.insertText(prompt);
      } catch (err) {
        vscode.window.showErrorMessage(`Couldn't load diagnostic context: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    // Register the code-action provider for all languages. The provider
    // surfaces a quick-fix on every diagnostic; picking it dispatches
    // `ailancers.fixWithAilancers` above.
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new AilancersCodeActionProvider(),
      { providedCodeActionKinds: AilancersCodeActionProvider.providedCodeActionKinds },
    ),

    // Open the .ailancers/settings.json file (the persisted permissions/hooks
    // /MCP config). Creates a starter template if missing.
    vscode.commands.registerCommand("ailancers.openPermissions", async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage("Open a folder first.");
        return;
      }
      const root = folders[0].uri.fsPath;
      const dir = require("node:path").join(root, ".ailancers");
      const file = require("node:path").join(dir, "settings.json");
      const fsp = require("node:fs/promises");
      try {
        await fsp.mkdir(dir, { recursive: true });
        try {
          await fsp.access(file);
        } catch {
          const starter = JSON.stringify({
            $schema: "https://ailancers.com/schemas/settings.schema.json",
            permissions: {
              allow: [
                "Bash(npm test)",
                "Bash(npm run *)",
                "Read(./src/**)"
              ],
              deny: [
                "Edit(.env*)",
                "Edit(.git/**)",
                "Edit(.ailancers/**)"
              ],
              ask: []
            },
            // hooks: {
            //   PreToolUse: [
            //     // Block edits the linter rejects:
            //     { matcher: "edit_file|write_file", command: "./scripts/format-check.sh", timeout: 60 }
            //   ],
            //   PostToolUse: [
            //     // Scan run_terminal output for leaked secrets:
            //     { matcher: "run_terminal", command: "./scripts/scan-secrets.sh" }
            //   ]
            // }
          }, null, 2) + "\n";
          await fsp.writeFile(file, starter, "utf-8");
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        await vscode.window.showTextDocument(doc);
      } catch (err) {
        vscode.window.showErrorMessage(`Ailancers: could not open permissions file — ${err instanceof Error ? err.message : err}`);
      }
    }),

    // Open the project rules file (.ailancers/instructions.md), creating a
    // template if it doesn't exist yet.
    vscode.commands.registerCommand("ailancers.openProjectRules", async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage("Open a folder first.");
        return;
      }
      const root = folders[0].uri.fsPath;
      const dir = require("node:path").join(root, ".ailancers");
      const file = require("node:path").join(dir, "instructions.md");
      const fsp = require("node:fs/promises");
      try {
        await fsp.mkdir(dir, { recursive: true });
        try {
          await fsp.access(file);
        } catch {
          // Create a starter template
          const starter = "# Project rules for Ailancers Code\n\n" +
            "These are the conventions Ailancers follows when working in this repo.\n" +
            "Anything you write below is auto-injected as `<project_rules>` on every agent turn.\n\n" +
            "## Conventions\n\n" +
            "- (write your project's testing, formatting, branching, naming rules here)\n";
          await fsp.writeFile(file, starter, "utf-8");
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        await vscode.window.showTextDocument(doc);
      } catch (err) {
        vscode.window.showErrorMessage(`Ailancers: could not open project rules — ${err instanceof Error ? err.message : err}`);
      }
    }),

    // Re-show the welcome walkthrough
    vscode.commands.registerCommand("ailancers.showWalkthrough", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        { category: "ailancers.ailancers-code#ailancers-getting-started" },
        false,
      );
    }),

    // Show the output channel — useful when filing bug reports
    vscode.commands.registerCommand("ailancers.showLogs", () => {
      outputChannel.show(true);
    }),

    // Open feedback URL pre-filled with version + platform info
    vscode.commands.registerCommand("ailancers.sendFeedback", async () => {
      const ext = require(`${context.extensionPath}/package.json`) as { version: string };
      const url = `https://feedback.ailancers.com/?ext=${encodeURIComponent(ext.version)}&vscode=${encodeURIComponent(vscode.version)}&platform=${encodeURIComponent(process.platform)}`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  // Register activity event listeners
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => activityTracker.onDocumentChange(e)),
    vscode.workspace.onDidSaveTextDocument((e) => activityTracker.onDocumentSave(e)),
    vscode.window.onDidChangeActiveTextEditor((e) => activityTracker.onEditorChange(e)),
    vscode.window.onDidChangeWindowState((e) => activityTracker.onWindowStateChange(e))
  );

  // Cleanup on deactivation
  context.subscriptions.push(
    activityTracker,
    screenCaptureService,
    hourlyBillingTracker,
    { dispose: () => systemIdleService.dispose() },
  );

  // Attempt auto-login
  const restored = await authService.tryRestoreSession();
  if (restored) {
    log("Session restored from stored credentials");
    const sessionId = await telemetryService.startSession();
    wsClient.connect();
    if (sessionId) {
      screenCaptureService.start(sessionId);
      log("Screen capture started");
      // Hourly billing tracker uses the same telemetry session id to upload
      // its slot screenshots to the existing /api/telemetry/screenshot endpoint.
      hourlyBillingTracker.setTelemetrySessionId(sessionId);
    }
    // Hourly billing tracker — only activates for HOURLY sub-projects
    hourlyBillingTracker.start().catch((err) =>
      log(`HourlyBillingTracker start failed: ${err}`),
    );
    // Pre-fetch user's projects in background so picker is instant
    projectPicker.fetchProjects().catch(() => {});
    // Prompt auto-start on first login
    autoStartService.promptOnFirstLogin().catch(() => {});
    // Check for updates
    checkForUpdates(apiClient, log);
    // Schedule midnight session reset
    scheduleMidnightReset(telemetryService, screenCaptureService, log, authService);
  } else {
    // Not logged in — open the Ailancers sidebar so the LoginScreen renders.
    // This runs every time the user starts VS Code while signed out, not just
    // on first install: a missed notification on day 1 doesn't doom them.
    log("[Onboarding] No session — revealing sidebar so the LoginScreen is visible");
    setTimeout(() => {
      void vscode.commands.executeCommand("workbench.view.extension.ailancers-sidebar")
        .then(() => vscode.commands.executeCommand("ailancers.chatView.focus"))
        .then(undefined, (err) => log(`Sidebar reveal failed: ${err}`));
    }, 1500); // Small delay so VS Code's window-restore finishes first

    // Modal welcome — only on the very first install per machine. Modal so it
    // can't be missed or auto-dismissed; users have to actively click Later or
    // Sign In. After they click, we never bother them again.
    const FIRST_RUN_KEY = "ailancers.shownFirstRunWelcome";
    const alreadyWelcomed = context.globalState.get<boolean>(FIRST_RUN_KEY, false);
    if (!alreadyWelcomed) {
      // Don't await — let activate() finish so other commands can register
      void (async () => {
        // Small delay so the welcome doesn't fight other startup notifications
        await new Promise((r) => setTimeout(r, 2000));
        const choice = await vscode.window.showInformationMessage(
          "Welcome to Ailancers Code! Sign in to start using the AI agent and time tracking.",
          { modal: true },
          "Sign In",
          "Open Get Started",
          "Later",
        );
        if (choice === "Sign In") {
          await vscode.commands.executeCommand("ailancers.login");
        } else if (choice === "Open Get Started") {
          await vscode.commands.executeCommand(
            "workbench.action.openWalkthrough",
            "ailancers.ailancers-code#ailancers-getting-started",
            true,
          );
        }
        await context.globalState.update(FIRST_RUN_KEY, true);
      })();
    }
  }

  // Listen for auth changes
  authService.onAuthStateChange(async (authenticated) => {
    if (authenticated) {
      const sessionId = await telemetryService.startSession();
      wsClient.connect();
      if (sessionId) {
        screenCaptureService.start(sessionId);
        hourlyBillingTracker.setTelemetrySessionId(sessionId);
      }
      hourlyBillingTracker.start().catch((err) =>
        log(`HourlyBillingTracker start failed: ${err}`),
      );
      // Pre-cache projects after login
      projectPicker.invalidateCache();
      projectPicker.fetchProjects().catch(() => {});
      // Prompt auto-start on first login
      autoStartService.promptOnFirstLogin().catch(() => {});
    } else {
      telemetryService.endSession();
      wsClient.disconnect();
      screenCaptureService.stop();
      hourlyBillingTracker.stop();
      hourlyBillingTracker.setTelemetrySessionId(null);
      projectPicker.clearSelection();
      projectPicker.invalidateCache();
    }
    statusBar.refresh();
    chatViewProvider.refresh();
  });

  log("Ailancers Code extension activated");
}

const CURRENT_VERSION = "0.2.18";

async function checkForUpdates(apiClient: import("./services/ApiClient").ApiClient, log: (msg: string) => void): Promise<void> {
  try {
    const resp = await apiClient.get<{ extension: { version: string; downloadUrl: string } }>("/api/version");
    if (resp.extension.version !== CURRENT_VERSION) {
      const action = await vscode.window.showInformationMessage(
        `Ailancers Code update available: v${resp.extension.version} (you have v${CURRENT_VERSION})`,
        "Download Update"
      );
      if (action === "Download Update") {
        vscode.env.openExternal(vscode.Uri.parse(resp.extension.downloadUrl));
      }
    } else {
      log(`Version check: up to date (v${CURRENT_VERSION})`);
    }
  } catch {
    // Silent fail
  }
}

function scheduleMidnightReset(
  telemetryService: import("./services/TelemetryService").TelemetryService,
  screenCaptureService: import("./services/ScreenCaptureService").ScreenCaptureService,
  log: (msg: string) => void,
  authService: import("./services/AuthService").AuthService,
): void {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(async () => {
    log("Midnight — resetting session for new day");
    // Skip the whole reset if the user logged out before midnight.
    // ScreenCaptureService also guards internally, but we want to skip
    // telemetryService.startSession() too — no point starting a new
    // tracking session for a logged-out user.
    if (!authService.isAuthenticated) {
      log("Skipping midnight reset — user is not authenticated");
      // Don't reschedule until they sign back in. The auth-state listener
      // re-arms the timer on next login via the start() path.
      return;
    }
    await telemetryService.endSession();
    const newSessionId = await telemetryService.startSession();
    if (newSessionId) {
      screenCaptureService.stop();
      screenCaptureService.start(newSessionId);
    }
    // Schedule next midnight
    scheduleMidnightReset(telemetryService, screenCaptureService, log, authService);
  }, msUntilMidnight);

  log(`Midnight reset scheduled in ${Math.round(msUntilMidnight / 60000)}m`);
}

export function deactivate() {
  // Cleanup is handled by VS Code's disposable subscriptions
}
