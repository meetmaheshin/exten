import * as vscode from "vscode";
import type { LoginResponse, RefreshResponse } from "@ailancers/shared-types";

type AuthStateListener = (authenticated: boolean) => void;

export class AuthService {
  private accessToken: string | null = null;
  private listeners: AuthStateListener[] = [];

  constructor(private secrets: vscode.SecretStorage) {}

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getServerUrl(): string {
    return vscode.workspace.getConfiguration("ailancers").get<string>("serverUrl", "http://localhost:3000");
  }

  onAuthStateChange(listener: AuthStateListener): void {
    this.listeners.push(listener);
  }

  private notifyListeners(authenticated: boolean) {
    for (const listener of this.listeners) {
      listener(authenticated);
    }
  }

  /** Login via webview form (email + password passed directly) */
  async login(email: string, password: string): Promise<{ success: boolean; error?: string; userName?: string }> {
    try {
      const url = this.getServerUrl();
      const response = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      // Safely parse response
      const text = await response.text();
      let data: LoginResponse;
      try {
        data = JSON.parse(text);
      } catch {
        return { success: false, error: `Server returned invalid response. Check server URL in settings (current: ${url})` };
      }

      if (!response.ok) {
        const errMsg = (data as unknown as { message?: string }).message || "Login failed";
        return { success: false, error: errMsg };
      }

      this.accessToken = data.accessToken;
      await this.secrets.store("ailancers.refreshToken", data.refreshToken);
      this.notifyListeners(true);
      return { success: true, userName: data.user.fullName };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("network")) {
        return { success: false, error: `Cannot reach server at ${this.getServerUrl()}. Check your Server URL setting.` };
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

  async tryRestoreSession(): Promise<boolean> {
    const refreshToken = await this.secrets.get("ailancers.refreshToken");
    if (!refreshToken) return false;

    try {
      const url = this.getServerUrl();
      const response = await fetch(`${url}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        await this.secrets.delete("ailancers.refreshToken");
        return false;
      }

      const text = await response.text();
      let data: RefreshResponse;
      try {
        data = JSON.parse(text);
      } catch {
        await this.secrets.delete("ailancers.refreshToken");
        return false;
      }

      this.accessToken = data.accessToken;
      await this.secrets.store("ailancers.refreshToken", data.refreshToken);
      this.notifyListeners(true);
      return true;
    } catch {
      return false;
    }
  }

  async refreshAccessToken(): Promise<string | null> {
    const refreshToken = await this.secrets.get("ailancers.refreshToken");
    if (!refreshToken) {
      this.accessToken = null;
      this.notifyListeners(false);
      return null;
    }

    try {
      const url = this.getServerUrl();
      const response = await fetch(`${url}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        this.accessToken = null;
        await this.secrets.delete("ailancers.refreshToken");
        this.notifyListeners(false);
        return null;
      }

      const text = await response.text();
      let data: RefreshResponse;
      try {
        data = JSON.parse(text);
      } catch {
        this.accessToken = null;
        this.notifyListeners(false);
        return null;
      }

      this.accessToken = data.accessToken;
      await this.secrets.store("ailancers.refreshToken", data.refreshToken);
      return this.accessToken;
    } catch {
      this.accessToken = null;
      this.notifyListeners(false);
      return null;
    }
  }

  async logout(): Promise<void> {
    const refreshToken = await this.secrets.get("ailancers.refreshToken");
    if (refreshToken && this.accessToken) {
      try {
        const url = this.getServerUrl();
        await fetch(`${url}/api/auth/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // Best effort
      }
    }

    this.accessToken = null;
    await this.secrets.delete("ailancers.refreshToken");
    this.notifyListeners(false);
  }
}
