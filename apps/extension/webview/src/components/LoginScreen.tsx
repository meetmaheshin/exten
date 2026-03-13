import { getVsCodeApi } from "../vscodeApi";

const FEATURES = [
  { icon: "\u26A1", label: "AI Agent", desc: "Code, edit files & run commands" },
  { icon: "\u{1F50D}", label: "QA Review", desc: "Find bugs & security issues" },
  { icon: "\u{1F3A8}", label: "Design Audit", desc: "Score & improve your UI" },
  { icon: "\u{1F4CA}", label: "Tracking", desc: "Time, activity & cost analytics" },
];

export function LoginScreen() {
  const handleLogin = () => {
    getVsCodeApi().postMessage({ type: "login" });
  };

  return (
    <div className="login-container">
      <div className="login-brand">
        <div className="login-logo">A</div>
        <div className="login-title">Ailancers Code</div>
        <div className="login-version">AI-Powered Development</div>
      </div>

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

      <button className="login-btn" onClick={handleLogin}>
        Sign In to Get Started
      </button>

      <div className="login-footer">
        Your team&apos;s AI coding assistant
      </div>
    </div>
  );
}
