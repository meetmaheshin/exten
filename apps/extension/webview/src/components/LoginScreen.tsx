import { getVsCodeApi } from "../vscodeApi";

export function LoginScreen() {
  const handleLogin = () => {
    getVsCodeApi().postMessage({ type: "login" });
  };

  return (
    <div className="login-container">
      <div className="login-icon">&#128187;</div>
      <div className="login-title">Ailancers Code</div>
      <div className="login-subtitle">
        Sign in to access your AI coding assistant, activity tracking, and team analytics.
      </div>
      <button className="login-btn" onClick={handleLogin}>
        Sign In
      </button>
    </div>
  );
}
