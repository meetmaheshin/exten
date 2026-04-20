import { useState } from "react";
import { getVsCodeApi } from "../vscodeApi";

const FEATURES = [
  { icon: "\u26A1", label: "AI Agent", desc: "Code, edit files & run commands" },
  { icon: "\u{1F50D}", label: "QA Review", desc: "Find bugs & security issues" },
  { icon: "\u{1F3A8}", label: "Design Audit", desc: "Score & improve your UI" },
  { icon: "\u{1F4CA}", label: "Tracking", desc: "Time, activity & cost analytics" },
];

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError("");
    getVsCodeApi().postMessage({ type: "login", email, password });
  };

  const handleBrowserLogin = () => {
    setBrowserLoading(true);
    setError("");
    getVsCodeApi().postMessage({ type: "loginWithBrowser" });
  };

  // Listen for login result from extension host
  const handler = (event: MessageEvent) => {
    const msg = event.data;
    if (msg.type === "loginResult") {
      setLoading(false);
      setBrowserLoading(false);
      if (!msg.success) {
        setError(msg.error || "Login failed");
      }
    }
  };

  // Register once
  useState(() => {
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  });

  return (
    <div className="login-container">
      <div className="login-brand">
        <div className="login-logo">A</div>
        <div className="login-title">Ailancers Code</div>
        <div className="login-version">AI-Powered Development</div>
      </div>

      {/* Browser login — primary */}
      <div className="login-form">
        <button
          className="login-btn login-btn-browser"
          onClick={handleBrowserLogin}
          disabled={browserLoading || loading}
        >
          {browserLoading ? "Waiting for login..." : "Login with Ailancers"}
        </button>
        {browserLoading && (
          <div className="login-browser-hint">
            A browser window has opened. Sign in there to continue.
          </div>
        )}
      </div>

      <div className="login-divider">
        <span>or sign in with email</span>
      </div>

      {/* Email/password — fallback */}
      <form className="login-form" onSubmit={handleSubmit}>
        <input
          className="login-input"
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading || browserLoading}
          autoComplete="email"
        />
        <input
          className="login-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading || browserLoading}
          autoComplete="current-password"
        />
        {error && <div className="login-error">{error}</div>}
        <button className="login-btn" type="submit" disabled={loading || browserLoading || !email || !password}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      <div className="login-features">
        {FEATURES.map((f) => (
          <div className="login-feature" key={f.label}>
            <span className="login-feature-icon">{f.icon}</span>
            <div className="login-feature-text">
              <span className="login-feature-label">{f.label}</span>
              <span className="login-feature-desc">{f.desc}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="login-footer">
        Your team&apos;s AI coding assistant
      </div>
    </div>
  );
}
