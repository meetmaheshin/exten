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
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  accessToken: null,
  login: async () => {},
  logout: () => {},
  isAdmin: false,
});

export function useAuth() {
  return useContext(AuthContext);
}

// Session storage helpers
const TOKEN_KEY = "ailancers_token";
const REFRESH_KEY = "ailancers_refresh";
const USER_KEY = "ailancers_user";

export function saveSession(accessToken: string, refreshToken: string, user: AuthUser) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(TOKEN_KEY, accessToken);
  sessionStorage.setItem(REFRESH_KEY, refreshToken);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function loadSession(): { accessToken: string; refreshToken: string; user: AuthUser } | null {
  if (typeof window === "undefined") return null;
  const token = sessionStorage.getItem(TOKEN_KEY);
  const refresh = sessionStorage.getItem(REFRESH_KEY);
  const userStr = sessionStorage.getItem(USER_KEY);
  if (!token || !refresh || !userStr) return null;
  try {
    return { accessToken: token, refreshToken: refresh, user: JSON.parse(userStr) };
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(USER_KEY);
}
