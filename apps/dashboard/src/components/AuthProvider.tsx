"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { AuthContext, type AuthUser, saveSession, loadSession, clearSession } from "@/lib/auth";
import { apiLogin, API_BASE } from "@/lib/api";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      // 1. Try localStorage first
      const stored = loadSession();
      if (stored) {
        setUser(stored.user);
        setAccessToken(stored.accessToken);
        setLoading(false);
        return;
      }

      // 2. Try auto-login from ailance_token cookie
      const cookies = document.cookie.split(";").map((c) => c.trim());
      const tokenCookie = cookies.find((c) => c.startsWith("ailance_token="));
      const cookieToken = tokenCookie ? tokenCookie.split("=").slice(1).join("=") : null;
      const lsToken = cookieToken || localStorage.getItem("ailance_token");

      if (lsToken) {
        try {
          const resp = await fetch(`${API_BASE}/api/auth/platform-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platformToken: lsToken }),
          });
          if (resp.ok) {
            const data = await resp.json() as { accessToken: string; user: AuthUser };
            setUser(data.user);
            setAccessToken(data.accessToken);
            saveSession(data.accessToken, data.user);
          }
        } catch {
          // Silent fail
        }
      }

      setLoading(false);
    }
    init();
  }, []);

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
    <AuthContext.Provider value={{ user, accessToken, loading, login, loginWithToken, logout, isAdmin, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}
