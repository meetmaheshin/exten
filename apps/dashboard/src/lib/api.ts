const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://exten-production.up.railway.app";
const PLATFORM_URL = "https://staging-backend.ailancers.com";

export { API_BASE };

interface FetchOptions extends RequestInit {
  token?: string;
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

/** Login via Ailancers platform — returns platform token + user */
export async function apiLogin(email: string, password: string) {
  const response = await fetch(`${PLATFORM_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.detail || "Login failed");
  }

  return {
    token: data.token as string,
    user: {
      id: data.user.id as string,
      email: data.user.email as string,
      fullName: data.user.name as string,
      role: (data.user.role as string) === "client" ? "admin" : (data.user.role as string),
      team: null as string | null,
    },
  };
}
