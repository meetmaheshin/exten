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
import { ChatViewProvider } from "./providers/ChatViewProvider";
import { StatusBarProvider } from "./providers/StatusBarProvider";
import { ActivityDashboardProvider } from "./providers/ActivityDashboardProvider";

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Ailancers Code");
  const log = (msg: string) => outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);

  log("Activating Ailancers Code extension...");

  // Initialize services
  const authService = new AuthService(context.secrets);
  const apiClient = new ApiClient(authService);
  const wsClient = new WebSocketClient(authService);
  const toolExecutor = new ToolExecutor(outputChannel);
  const approvalService = new ApprovalService();
  const chatService = new ChatService(apiClient, wsClient, toolExecutor, approvalService);
  const activityTracker = new ActivityTracker();
  const telemetryService = new TelemetryService(apiClient, activityTracker);
  const screenCaptureService = new ScreenCaptureService(context, apiClient);

  // Register sidebar webview
  const chatViewProvider = new ChatViewProvider(context.extensionUri, chatService, apiClient, authService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("ailancers.chatView", chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Activity dashboard provider
  const activityDashboard = new ActivityDashboardProvider(context.extensionUri, apiClient, activityTracker);

  // Register status bar
  const statusBar = new StatusBarProvider(authService, activityTracker);
  context.subscriptions.push(statusBar);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("ailancers.login", () => authService.promptLogin()),
    vscode.commands.registerCommand("ailancers.logout", async () => {
      await authService.logout();
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
  context.subscriptions.push(activityTracker, screenCaptureService);

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
  }

  // Listen for auth changes
  authService.onAuthStateChange(async (authenticated) => {
    if (authenticated) {
      const sessionId = await telemetryService.startSession();
      wsClient.connect();
      if (sessionId) {
        screenCaptureService.start(sessionId);
      }
    } else {
      telemetryService.endSession();
      wsClient.disconnect();
      screenCaptureService.stop();
    }
    statusBar.refresh();
    chatViewProvider.refresh();
  });

  log("Ailancers Code extension activated");
}

export function deactivate() {
  // Cleanup is handled by VS Code's disposable subscriptions
}
