"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { AuthContext, type AuthUser, saveSession, loadSession, clearSession } from "@/lib/auth";
import { apiLogin } from "@/lib/api";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadSession();
    if (stored) {
      setUser(stored.user);
      setAccessToken(stored.accessToken);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    setUser(result.user);
    setAccessToken(result.accessToken);
    saveSession(result.accessToken, result.refreshToken, result.user);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    clearSession();
  }, []);

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  return (
    <AuthContext.Provider value={{ user, accessToken, login, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}
