import * as vscode from "vscode";
import { AuthService } from "./services/AuthService";
import { ApiClient } from "./services/ApiClient";
import { WebSocketClient } from "./services/WebSocketClient";
import { ChatService } from "./services/ChatService";
import { ToolExecutor } from "./services/ToolExecutor";
import { ApprovalService } from "./services/ApprovalService";
import { ActivityTracker } from "./services/ActivityTracker";
import { TelemetryService } from "./services/TelemetryService";
import { ScreenCaptureService } from "./services/ScreenCaptureService";
import { HourlyBillingTracker } from "./services/HourlyBillingTracker";
import { SystemIdleService } from "./services/SystemIdleService";
import { AutoStartService } from "./services/AutoStartService";
import { ProjectPickerService } from "./services/ProjectPickerService";
import { WorkspaceContextService } from "./services/WorkspaceContextService";
import { ChatViewProvider } from "./providers/ChatViewProvider";
import { StatusBarProvider } from "./providers/StatusBarProvider";
import { ActivityDashboardProvider } from "./providers/ActivityDashboardProvider";

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
  const approvalService = new ApprovalService();
  const chatService = new ChatService(apiClient, wsClient, toolExecutor, approvalService);
  const workspaceContext = new WorkspaceContextService();
  chatService.setWorkspaceContext(workspaceContext);
  const systemIdleService = new SystemIdleService();
  systemIdleService.start();
  const activityTracker = new ActivityTracker(systemIdleService);
  const projectPicker = new ProjectPickerService(authService, context);
  chatService.setProjectPicker(projectPicker);
  const telemetryService = new TelemetryService(apiClient, activityTracker, projectPicker);
  const screenCaptureService = new ScreenCaptureService(context, apiClient, activityTracker);
  const hourlyBillingTracker = new HourlyBillingTracker(
    context,
    apiClient,
    authService,
    projectPicker,
    activityTracker,
  );
  const autoStartService = new AutoStartService(context);

  // Register sidebar webview
  const chatViewProvider = new ChatViewProvider(context.extensionUri, chatService, apiClient, authService);
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
    scheduleMidnightReset(telemetryService, screenCaptureService, log);
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

const CURRENT_VERSION = "0.2.4";

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
  log: (msg: string) => void
): void {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(async () => {
    log("Midnight — resetting session for new day");
    await telemetryService.endSession();
    const newSessionId = await telemetryService.startSession();
    if (newSessionId) {
      screenCaptureService.stop();
      screenCaptureService.start(newSessionId);
    }
    // Schedule next midnight
    scheduleMidnightReset(telemetryService, screenCaptureService, log);
  }, msUntilMidnight);

  log(`Midnight reset scheduled in ${Math.round(msUntilMidnight / 60000)}m`);
}

export function deactivate() {
  // Cleanup is handled by VS Code's disposable subscriptions
}
