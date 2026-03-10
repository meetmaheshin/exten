import * as vscode from "vscode";
import type { AuthService } from "./AuthService";

export class ApiClient {
  constructor(private authService: AuthService) {}

  private getBaseUrl(): string {
    return this.authService.getServerUrl();
  }

  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.getBaseUrl()}${path}`;
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");

    const token = this.authService.getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    let response = await fetch(url, { ...options, headers });

    // Auto-refresh on 401
    if (response.status === 401 && token) {
      const newToken = await this.authService.refreshAccessToken();
      if (newToken) {
        headers.set("Authorization", `Bearer ${newToken}`);
        response = await fetch(url, { ...options, headers });
      }
    }

    return response;
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.fetch(path);
    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }
}
