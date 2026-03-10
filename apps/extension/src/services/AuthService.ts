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

    try {
      const url = this.getServerUrl();
      const response = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const err = (await response.json()) as { message?: string };
        throw new Error(err.message || "Login failed");
      }

      const data = (await response.json()) as LoginResponse;
      this.accessToken = data.accessToken;
      await this.secrets.store("ailancers.refreshToken", data.refreshToken);
      this.notifyListeners(true);
      vscode.window.showInformationMessage(`Ailancers: Logged in as ${data.user.fullName}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Ailancers: Login failed - ${err instanceof Error ? err.message : "Unknown error"}`);
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

      const data = (await response.json()) as RefreshResponse;
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

      const data = (await response.json()) as RefreshResponse;
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
