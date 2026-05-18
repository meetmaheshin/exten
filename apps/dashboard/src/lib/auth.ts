"use client";

import { createContext, useContext } from "react";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  team: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string, user: AuthUser) => void;
  logout: () => void;
  isAdmin: boolean;
  isManager: boolean;
  isSuperAdmin: boolean;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  accessToken: null,
  loading: true,
  login: async () => {},
  loginWithToken: () => {},
  logout: () => {},
  isAdmin: false,
  isManager: false,
  isSuperAdmin: false,
});

export function useAuth() {
  return useContext(AuthContext);
}

// Session storage helpers (single platform token)
const TOKEN_KEY = "ailancers_token";
const USER_KEY = "ailancers_user";

export function saveSession(token: string, user: AuthUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function loadSession(): { accessToken: string; user: AuthUser } | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(TOKEN_KEY);
  const userStr = localStorage.getItem(USER_KEY);
  if (!token || !userStr) return null;
  try {
    return { accessToken: token, user: JSON.parse(userStr) };
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
