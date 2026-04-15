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
    setAccessToken(result.token);
    saveSession(result.token, result.user);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    clearSession();
  }, []);

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const isManager = isAdmin || user?.role === "manager";

  return (
    <AuthContext.Provider value={{ user, accessToken, login, logout, isAdmin, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}
