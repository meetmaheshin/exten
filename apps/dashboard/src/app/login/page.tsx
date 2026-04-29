"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { API_BASE } from "@/lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [browserLoading, setBrowserLoading] = useState(false);
  const { login, loginWithToken, user } = useAuth();
  const router = useRouter();

  // If already logged in (auto-login from cookie), redirect
  useEffect(() => {
    if (user) router.push("/me");
  }, [user, router]);

  // Pick up session-expired message stashed by AuthProvider on 401
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reason = sessionStorage.getItem("ailancers_login_reason");
    if (reason) {
      setError(reason);
      sessionStorage.removeItem("ailancers_login_reason");
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleBrowserLogin() {
    setBrowserLoading(true);
    setError("");
    try {
      // Get device code
      const codeResp = await fetch(`${API_BASE}/api/auth/device-code`, { method: "POST" });
      if (!codeResp.ok) throw new Error("Failed to start login");
      const { code } = await codeResp.json() as { code: string };

      // Open auth bridge in new tab
      window.open(`${API_BASE}/auth-bridge?code=${code}`, "_blank");

      // Poll for completion
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollResp = await fetch(`${API_BASE}/api/auth/device-code/poll?code=${code}`);
        if (!pollResp.ok) continue;
        const poll = await pollResp.json() as { status: string; accessToken?: string; user?: { id: string; email: string; fullName: string; role: string; team: string | null } };
        if (poll.status === "complete" && poll.accessToken && poll.user) {
          loginWithToken(poll.accessToken, poll.user);
          router.push("/me");
          return;
        }
        if (poll.status === "expired") {
          throw new Error("Login expired. Try again.");
        }
      }
      throw new Error("Login timed out");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Browser login failed");
    } finally {
      setBrowserLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/dashboard/logo.png" alt="Ailancers" style={{ width: 48, height: 48, marginBottom: 8 }} />
        <div className="login-title">Ailancers Dashboard</div>
        <div className="login-subtitle">Sign in with your Ailancers account.</div>

        {/* Browser login — primary */}
        <button
          className="btn btn-primary"
          onClick={handleBrowserLogin}
          disabled={browserLoading || loading}
          style={{ width: "100%", justifyContent: "center", marginBottom: browserLoading ? 8 : 16 }}
        >
          {browserLoading ? "Waiting for login..." : "Login with Ailancers"}
        </button>
        {browserLoading && (
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", marginBottom: 16, animation: "pulse 2s infinite" }}>
            A new tab has opened. Sign in there to continue.
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 16px", color: "var(--text-muted)", fontSize: 12 }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span>or sign in with email</span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required disabled={browserLoading} />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required disabled={browserLoading} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading || browserLoading} style={{ width: "100%", justifyContent: "center" }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
