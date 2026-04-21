"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { AuthContext, type AuthUser, saveSession, loadSession, clearSession } from "@/lib/auth";
import { apiLogin, API_BASE, apiFetch } from "@/lib/api";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Restore session from localStorage or try auto-login from cookie
  useEffect(() => {
    const stored = loadSession();
    if (stored) {
      setUser(stored.user);
      setAccessToken(stored.accessToken);
      return;
    }

    // Try auto-login from ailance_token cookie (shared across .ailancers.com)
    tryAutoLogin();
  }, []);

  async function tryAutoLogin() {
    // Check cookie
    const cookies = document.cookie.split(";").map((c) => c.trim());
    const tokenCookie = cookies.find((c) => c.startsWith("ailance_token="));
    const token = tokenCookie ? tokenCookie.split("=").slice(1).join("=") : null;

    // Also check localStorage from other Ailancers apps
    const lsToken = token || localStorage.getItem("ailance_token");

    if (!lsToken) return;

    try {
      const resp = await fetch(`${API_BASE}/api/auth/platform-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformToken: lsToken }),
      });
      if (!resp.ok) return;
      const data = await resp.json() as { accessToken: string; user: AuthUser };
      setUser(data.user);
      setAccessToken(data.accessToken);
      saveSession(data.accessToken, data.user);
    } catch {
      // Silent fail — show login page
    }
  }

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    setUser(result.user);
    setAccessToken(result.token);
    saveSession(result.token, result.user);
  }, []);

  const loginWithToken = useCallback((token: string, userData: AuthUser) => {
    setUser(userData);
    setAccessToken(token);
    saveSession(token, userData);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    clearSession();
  }, []);

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const isManager = isAdmin || user?.role === "manager";

  return (
    <AuthContext.Provider value={{ user, accessToken, login, loginWithToken, logout, isAdmin, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}
