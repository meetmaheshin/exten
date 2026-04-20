const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://apivscode.ailancers.com";

export { API_BASE };

interface FetchOptions extends RequestInit {
  token?: string;
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);

  // Only set Content-Type for requests with a body
  if (fetchOptions.body) {
    headers.set("Content-Type", "application/json");
  }

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

/** Login via backend — returns JWT token + user */
export async function apiLogin(email: string, password: string) {
  // Try platform proxy login first (works for all Ailancers users)
  const platformResp = await fetch(`${API_BASE}/api/auth/platform-proxy-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (platformResp.ok) {
    const platformData = await platformResp.json() as { token: string };
    // Exchange platform token for local JWT
    const exchangeResp = await fetch(`${API_BASE}/api/auth/platform-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platformToken: platformData.token }),
    });

    if (exchangeResp.ok) {
      const data = await exchangeResp.json() as { accessToken: string; user: { id: string; email: string; fullName: string; role: string; team: string | null } };
      return { token: data.accessToken, user: data.user };
    }
  }

  // Fallback: try local backend login
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || data.detail || "Login failed");
  }

  return {
    token: data.accessToken as string,
    user: {
      id: data.user.id as string,
      email: data.user.email as string,
      fullName: data.user.fullName as string,
      role: data.user.role as string,
      team: (data.user.team ?? null) as string | null,
    },
  };
}
