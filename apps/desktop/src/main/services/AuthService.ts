import { EventEmitter } from "node:events";
import type { SecureStore } from "./SecureStore";
import type { ConfigStore } from "./ConfigStore";

const TOKEN_KEY = "ailancers.token";
const USER_KEY = "ailancers.user";
const PLATFORM_URL = "https://staging-backend.ailancers.com";

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
}

export class AuthService extends EventEmitter {
  private accessToken: string | null = null;
  private user: UserInfo | null = null;

  constructor(
    private secureStore: SecureStore,
    private configStore: ConfigStore
  ) {
    super();
  }

  get isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getUser(): UserInfo | null {
    return this.user;
  }

  getServerUrl(): string {
    return this.configStore.get("serverUrl");
  }

  async login(email: string, password: string): Promise<UserInfo> {
    const resp = await fetch(`${PLATFORM_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Login failed: ${body}`);
    }

    const data = await resp.json() as { token: string; user: UserInfo };
    this.accessToken = data.token;
    this.user = data.user;

    this.secureStore.set(TOKEN_KEY, data.token);
    this.secureStore.set(USER_KEY, JSON.stringify(data.user));
    this.emit("authenticated", true);

    return data.user;
  }

  async tryRestoreSession(): Promise<boolean> {
    const token = this.secureStore.get(TOKEN_KEY);
    if (!token) return false;

    try {
      const resp = await fetch(`${PLATFORM_URL}/api/v1/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        this.clearCredentials();
        return false;
      }

      const data = await resp.json() as { token?: string; user?: UserInfo };
      this.accessToken = data.token || token;
      this.secureStore.set(TOKEN_KEY, this.accessToken);

      // Restore user from stored data or verify response
      if (data.user) {
        this.user = data.user;
        this.secureStore.set(USER_KEY, JSON.stringify(data.user));
      } else {
        const storedUser = this.secureStore.get(USER_KEY);
        if (storedUser) this.user = JSON.parse(storedUser);
      }

      this.emit("authenticated", true);
      return true;
    } catch {
      return false;
    }
  }

  async refreshAccessToken(): Promise<string | null> {
    const token = this.secureStore.get(TOKEN_KEY);
    if (!token) return null;

    try {
      const resp = await fetch(`${PLATFORM_URL}/api/v1/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        this.clearCredentials();
        return null;
      }

      const data = await resp.json() as { token?: string };
      const newToken = data.token || token;
      this.accessToken = newToken;
      this.secureStore.set(TOKEN_KEY, newToken);
      return newToken;
    } catch {
      return null;
    }
  }

  logout(): void {
    this.clearCredentials();
    this.emit("authenticated", false);
  }

  private clearCredentials(): void {
    this.accessToken = null;
    this.user = null;
    this.secureStore.delete(TOKEN_KEY);
    this.secureStore.delete(USER_KEY);
  }
}
