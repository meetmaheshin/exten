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
import { SystemIdleService } from "./services/SystemIdleService";
import { AutoStartService } from "./services/AutoStartService";
import { ProjectPickerService } from "./services/ProjectPickerService";
import { ChatViewProvider } from "./providers/ChatViewProvider";
import { StatusBarProvider } from "./providers/StatusBarProvider";
import { ActivityDashboardProvider } from "./providers/ActivityDashboardProvider";

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Ailancers Code");
  const log = (msg: string) => outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);

  log("Activating Ailancers Code extension...");

  // Expose output channel globally for debug logging in services
  (globalThis as Record<string, unknown>).__ailancersOutput = outputChannel;

  // Initialize services
  const authService = new AuthService(context.secrets);
  const apiClient = new ApiClient(authService);
  const wsClient = new WebSocketClient(authService);
  const toolExecutor = new ToolExecutor(outputChannel);
  const approvalService = new ApprovalService();
  const chatService = new ChatService(apiClient, wsClient, toolExecutor, approvalService);
  const systemIdleService = new SystemIdleService();
  systemIdleService.start();
  const activityTracker = new ActivityTracker(systemIdleService);
  const projectPicker = new ProjectPickerService(apiClient, context);
  const telemetryService = new TelemetryService(apiClient, activityTracker, projectPicker);
  const screenCaptureService = new ScreenCaptureService(context, apiClient, activityTracker);
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

  // Register status bar (now includes project picker)
  const statusBar = new StatusBarProvider(authService, activityTracker, projectPicker);
  context.subscriptions.push(statusBar, projectPicker);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("ailancers.login", () => authService.promptLogin()),
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
      const projects = await projectPicker.fetchMyProjects(true);
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
  context.subscriptions.push(activityTracker, screenCaptureService, { dispose: () => systemIdleService.dispose() });

  // Attempt auto-login
  const restored = await authService.tryRestoreSession();
  if (restored) {
    log("Session restored from stored credentials");
    const sessionId = await telemetryService.startSession();
    wsClient.connect();
    if (sessionId) {
      screenCaptureService.start(sessionId);
      log("Screen capture started");
    }
    // Pre-fetch user's projects in background so picker is instant
    projectPicker.fetchMyProjects().catch(() => {});
    // Prompt auto-start on first login
    autoStartService.promptOnFirstLogin().catch(() => {});
  }

  // Listen for auth changes
  authService.onAuthStateChange(async (authenticated) => {
    if (authenticated) {
      const sessionId = await telemetryService.startSession();
      wsClient.connect();
      if (sessionId) {
        screenCaptureService.start(sessionId);
      }
      // Pre-cache projects after login
      projectPicker.invalidateCache();
      projectPicker.fetchMyProjects().catch(() => {});
      // Prompt auto-start on first login
      autoStartService.promptOnFirstLogin().catch(() => {});
    } else {
      telemetryService.endSession();
      wsClient.disconnect();
      screenCaptureService.stop();
      projectPicker.clearSelection();
      projectPicker.invalidateCache();
    }
    statusBar.refresh();
    chatViewProvider.refresh();
  });

  log("Ailancers Code extension activated");
}

export function deactivate() {
  // Cleanup is handled by VS Code's disposable subscriptions
}
