import * as vscode from "vscode";
import type { LoginResponse, VerifyResponse } from "@ailancers/shared-types";

type AuthStateListener = (authenticated: boolean) => void;

const PLATFORM_URL = "https://staging-backend.ailancers.com";

export class AuthService {
  private accessToken: string | null = null;
  private userName: string | null = null;
  private listeners: AuthStateListener[] = [];

  constructor(private secrets: vscode.SecretStorage) {}

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getUserName(): string | null {
    return this.userName;
  }

  getServerUrl(): string {
    return vscode.workspace.getConfiguration("ailancers").get<string>("serverUrl", "https://apivscode.ailancers.com");
  }

  onAuthStateChange(listener: AuthStateListener): void {
    this.listeners.push(listener);
  }

  private notifyListeners(authenticated: boolean) {
    for (const listener of this.listeners) {
      listener(authenticated);
    }
  }

  /** Login via Ailancers platform API */
  async login(email: string, password: string): Promise<{ success: boolean; error?: string; userName?: string }> {
    try {
      const response = await fetch(`${PLATFORM_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const text = await response.text();
      let data: LoginResponse;
      try {
        data = JSON.parse(text);
      } catch {
        return { success: false, error: "Server returned invalid response" };
      }

      if (!response.ok) {
        const errMsg = (data as unknown as { message?: string }).message || "Login failed";
        return { success: false, error: errMsg };
      }

      this.accessToken = data.token;
      this.userName = data.user.name;
      await this.secrets.store("ailancers.platformToken", data.token);
      this.notifyListeners(true);
      return { success: true, userName: data.user.name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("network")) {
        return { success: false, error: "Cannot reach Ailancers server. Check your internet connection." };
      }
      return { success: false, error: msg };
    }
  }

  /** Legacy: prompt login via VS Code input boxes (fallback) */
  async promptLogin(): Promise<void> {
    const email = await vscode.window.showInputBox({
      prompt: "Enter your Ailancers email",
      placeHolder: "you@company.com",
      validateInput: (v) => (v.includes("@") ? null : "Enter a valid email"),
    });
    if (!email) return;

    const password = await vscode.window.showInputBox({
      prompt: "Enter your password",
      password: true,
    });
    if (!password) return;

    const result = await this.login(email, password);
    if (result.success) {
      vscode.window.showInformationMessage(`Ailancers: Logged in as ${result.userName}`);
    } else {
      vscode.window.showErrorMessage(`Ailancers: Login failed - ${result.error}`);
    }
  }

  /** Restore session using stored token + verify endpoint */
  async tryRestoreSession(): Promise<boolean> {
    const token = await this.secrets.get("ailancers.platformToken");
    if (!token) return false;

    try {
      const response = await fetch(`${PLATFORM_URL}/api/v1/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        await this.secrets.delete("ailancers.platformToken");
        return false;
      }

      const text = await response.text();
      let data: VerifyResponse;
      try {
        data = JSON.parse(text);
      } catch {
        await this.secrets.delete("ailancers.platformToken");
        return false;
      }

      // Verify returns a refreshed token — store the new one
      this.accessToken = data.token;
      this.userName = data.user.name;
      await this.secrets.store("ailancers.platformToken", data.token);
      this.notifyListeners(true);
      return true;
    } catch {
      return false;
    }
  }

  /** Refresh access token using verify endpoint */
  async refreshAccessToken(): Promise<string | null> {
    const token = await this.secrets.get("ailancers.platformToken");
    if (!token) {
      this.accessToken = null;
      this.notifyListeners(false);
      return null;
    }

    try {
      const response = await fetch(`${PLATFORM_URL}/api/v1/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        this.accessToken = null;
        await this.secrets.delete("ailancers.platformToken");
        this.notifyListeners(false);
        return null;
      }

      const text = await response.text();
      let data: VerifyResponse;
      try {
        data = JSON.parse(text);
      } catch {
        this.accessToken = null;
        this.notifyListeners(false);
        return null;
      }

      this.accessToken = data.token;
      this.userName = data.user.name;
      await this.secrets.store("ailancers.platformToken", data.token);
      return this.accessToken;
    } catch {
      this.accessToken = null;
      this.notifyListeners(false);
      return null;
    }
  }

  async logout(): Promise<void> {
    this.accessToken = null;
    this.userName = null;
    await this.secrets.delete("ailancers.platformToken");
    this.notifyListeners(false);
  }
}
