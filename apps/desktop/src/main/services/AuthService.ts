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

  /** Login with a pre-obtained token (from browser auth bridge) */
  async loginWithToken(token: string, userHint?: { name: string }): Promise<void> {
    console.log(`[Auth] loginWithToken called, token length=${token?.length}, starts with: ${token?.slice(0, 20)}...`);
    this.accessToken = token;
    this.user = {
      id: "",
      name: userHint?.name || "User",
      email: "",
      role: "developer",
    };

    this.secureStore.set(TOKEN_KEY, token);
    this.secureStore.set(USER_KEY, JSON.stringify(this.user));
    console.log(`[Auth] Token stored, emitting authenticated`);
    this.emit("authenticated", true);
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

      // Don't emit "authenticated" here — the caller handles the restored
      // path explicitly. Emitting would cause startTracking() to run twice.
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

      if (resp.ok) {
        const data = await resp.json() as { token?: string };
        const newToken = data.token || token;
        this.accessToken = newToken;
        this.secureStore.set(TOKEN_KEY, newToken);
        return newToken;
      }

      // Token is genuinely invalid → clear credentials and force re-login.
      // Anything else (5xx, 429, 504) means "platform couldn't answer right
      // now" — keep the stored token and just return null so the caller's
      // request fails this cycle. Next heartbeat will retry with the same
      // token; when the platform comes back, things resume automatically
      // without the user having to sign in again.
      //
      // This was a real production bug: a 502 from the platform's nginx
      // (server restart) was logging users out and forcing them to
      // re-authenticate every time something blipped.
      if (resp.status === 401 || resp.status === 403) {
        this.clearCredentials();
        return null;
      }
      return null;
    } catch {
      // Network error / DNS / TLS handshake failure — same logic: don't
      // clear creds, just fail this attempt.
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
