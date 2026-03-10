import * as vscode from "vscode";
import type { AuthService } from "./AuthService";
import type { WsClientMessage, WsServerMessage } from "@ailancers/shared-types";

type MessageHandler = (message: WsServerMessage) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(private authService: AuthService) {}

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const token = this.authService.getAccessToken();
    if (!token) return;

    const serverUrl = this.authService.getServerUrl();
    const wsUrl = serverUrl.replace(/^http/, "ws") + `/api/chat/stream?token=${token}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as WsServerMessage;
          for (const handler of this.handlers) {
            handler(message);
          }
        } catch {
          // Ignore parse errors
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: WsClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    if (!this.authService.isAuthenticated) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
