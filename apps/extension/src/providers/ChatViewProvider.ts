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

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly chatService: ChatService,
    private readonly apiClient: ApiClient,
    private readonly authService: AuthService
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

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
          this.chatService.sendAgentMessage(
            msg.conversationId,
            msg.content,
            (wsMsg) => this.postToWebview(wsMsg),
            msg.model,
            msg.agentType,
            msg.images
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
          this.chatService.resolveApproval(msg.toolCallId, msg.decision);
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
        case "login": {
          if (msg.email && msg.password) {
            const result = await this.authService.login(msg.email, msg.password);
            this.postToWebview({ type: "loginResult", success: result.success, error: result.error });
          } else {
            await this.authService.promptLogin();
          }
          break;
        }
        case "getAuthState": {
          this.postToWebview({
            type: "authState",
            authenticated: this.authService.isAuthenticated,
          });
          break;
        }
      }
    });
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
    this.view?.webview.postMessage(message);
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
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:;">
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
