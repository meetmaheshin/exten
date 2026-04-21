"use client";

import { useState } from "react";

// Google Drive direct-download URLs
const VSIX_URL = "https://drive.google.com/uc?export=download&id=1fEHytm4817ligiYhucoiSUHKFEdYnlVX";
const DESKTOP_WIN_URL = "https://drive.google.com/uc?export=download&id=1akdGout7A5__VwKEDc1KM8dq5P8vcpu5";

const sectionStyle = { background: "#1c1e2e", borderRadius: 12, border: "1px solid #2a2d3e", padding: 28, marginBottom: 24 };
const headingStyle = { fontSize: 16, fontWeight: 700 as const, color: "#818cf8", marginBottom: 16 };
const stepNumStyle = { display: "inline-flex" as const, alignItems: "center" as const, justifyContent: "center" as const, width: 24, height: 24, borderRadius: "50%", background: "#6366f1", color: "#fff", fontSize: 12, fontWeight: 700 as const, marginRight: 10, flexShrink: 0 };
const stepRowStyle = { display: "flex", alignItems: "flex-start" as const, gap: 0, marginBottom: 14 };
const stepTextStyle = { fontSize: 13, color: "#c4c4cc", lineHeight: 1.6 };
const tipStyle = { fontSize: 12, color: "#94a3b8", background: "#0f0f23", padding: "8px 12px", borderRadius: 6, marginTop: 6, borderLeft: "3px solid #6366f1" };
const kbdStyle = { display: "inline-block", background: "#0f0f23", border: "1px solid #334155", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontFamily: "monospace", color: "#e4e4e7" };

export default function DownloadsPage() {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e4e4e7" }}>
      {/* Header */}
      <header style={{ padding: "40px 24px 32px", textAlign: "center", borderBottom: "1px solid #2a2d3e", background: "linear-gradient(180deg, #161822 0%, #0f1117 100%)" }}>
        <img src="/dashboard/logo.png" alt="Ailancers" style={{ width: 56, height: 56, marginBottom: 12 }} />
        <div style={{ fontSize: 36, marginBottom: 8 }}>
          <span style={{ color: "#f5c518", fontWeight: 800 }}>Ailancers</span>{" "}
          <span style={{ fontWeight: 300 }}>Tracker</span>
        </div>
        <p style={{ color: "#8b8d98", fontSize: 16, maxWidth: 600, margin: "0 auto" }}>
          Download, install, and start tracking in under 2 minutes. Choose the right app for your role.
        </p>
      </header>

      <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px" }}>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* VS CODE EXTENSION */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={sectionStyle}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 36 }}>💻</span>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>VS Code Extension</h2>
              <p style={{ color: "#8b8d98", fontSize: 13, margin: 0 }}>For developers and engineers who use VS Code</p>
            </div>
          </div>
          <div style={{ display: "inline-block", background: "#6366f120", color: "#818cf8", fontSize: 11, padding: "2px 8px", borderRadius: 4, marginBottom: 20 }}>
            Developers, Engineers
          </div>

          {/* Download */}
          <a href={VSIX_URL} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "#6366f1", color: "white", borderRadius: 8, fontWeight: 600, fontSize: 15, textDecoration: "none", marginBottom: 24 }}>
            <span>⬇ Download VS Code Extension (.vsix)</span>
            <span style={{ fontSize: 12, opacity: 0.8 }}>~450 KB</span>
          </a>

          {/* Step by step */}
          <h3 style={headingStyle}>Installation Guide</h3>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>1</span>
            <div style={stepTextStyle}>
              <strong>Install VS Code</strong> if you don{"'"}t have it already.
              <div style={tipStyle}>Download from <strong>https://code.visualstudio.com</strong> — available for Windows, macOS, and Linux.</div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>2</span>
            <div style={stepTextStyle}>
              <strong>Download the .vsix file</strong> using the button above. Save it anywhere on your computer.
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>3</span>
            <div style={stepTextStyle}>
              <strong>Install the extension:</strong>
              <div style={tipStyle}>
                Open VS Code → Press <span style={kbdStyle}>Ctrl+Shift+P</span> (or <span style={kbdStyle}>Cmd+Shift+P</span> on Mac) → Type <strong>"Install from VSIX"</strong> → Select the downloaded file → Click <strong>Install</strong> → Reload VS Code when prompted.
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>4</span>
            <div style={stepTextStyle}>
              <strong>Login:</strong> You{"'"}ll see the Ailancers panel in the sidebar. Click <strong>"Login with Ailancers"</strong> — your browser will open for authentication. Sign in with your Ailancers account (email, Google, etc). The extension will auto-detect your login.
              <div style={tipStyle}>
                Alternatively, type your email and password directly in the extension{"'"}s login form.
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>5</span>
            <div style={stepTextStyle}>
              <strong>Select your project:</strong> Click the <strong>📁 Select Project</strong> button in the bottom status bar, or press <span style={kbdStyle}>Ctrl+Shift+P</span> → <strong>"Ailancers: Select Project"</strong>. Pick the project and sub-project you{"'"}re working on.
              <div style={tipStyle}>You can switch projects anytime. All your activity will be tagged to the selected project for billing and reporting.</div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>6</span>
            <div style={stepTextStyle}>
              <strong>Start working!</strong> Tracking starts automatically. The extension tracks:
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                <li>Active and idle time</li>
                <li>Keystrokes and file saves</li>
                <li>Screenshots every 5 minutes</li>
                <li>AI chat/coding usage and costs</li>
              </ul>
              <div style={tipStyle}>
                If you{"'"}re idle for 10+ minutes, tracking pauses automatically. It resumes when you start working again.
              </div>
            </div>
          </div>

          <h3 style={{ ...headingStyle, marginTop: 24 }}>Using the AI Coding Agent</h3>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>💬</span>
            <div style={stepTextStyle}>
              <strong>Chat Mode:</strong> Open the Ailancers panel (sidebar) → type a question → get AI-powered answers. Great for quick questions, explanations, and brainstorming.
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>⚡</span>
            <div style={stepTextStyle}>
              <strong>Agent Mode:</strong> Click <strong>"Agent"</strong> toggle → the AI can read your files, write code, run commands, and edit your project directly. It works like having a senior developer pair-programming with you.
              <div style={tipStyle}>
                Toggle between <strong>Code</strong> (writes code), <strong>QA</strong> (finds bugs), and <strong>Design</strong> (audits UI quality) modes.
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>✅</span>
            <div style={stepTextStyle}>
              <strong>Approvals:</strong> When the agent wants to write or edit a file, you{"'"}ll see an approval prompt. Click <strong>Allow</strong> to proceed, <strong>Allow All</strong> to skip approvals for this session, or <strong>Deny</strong> to reject.
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* DESKTOP TRACKER */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={sectionStyle}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 36 }}>🖥️</span>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Desktop Tracker</h2>
              <p style={{ color: "#8b8d98", fontSize: 13, margin: 0 }}>For HR, admins, designers, managers — anyone not using VS Code</p>
            </div>
          </div>
          <div style={{ display: "inline-block", background: "#6366f120", color: "#818cf8", fontSize: 11, padding: "2px 8px", borderRadius: 4, marginBottom: 20 }}>
            Non-developers, All teams
          </div>

          {/* Downloads */}
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, marginBottom: 24 }}>
            <a href={DESKTOP_WIN_URL} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "#6366f1", color: "white", borderRadius: 8, fontWeight: 600, fontSize: 15, textDecoration: "none" }}>
              <span>⬇ Download for Windows (.exe)</span>
              <span style={{ fontSize: 12, opacity: 0.8 }}>~80 MB</span>
            </a>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ flex: 1, padding: "10px 14px", background: "#2a2d3e", color: "#64748b", borderRadius: 8, fontSize: 13, textAlign: "center" as const }}>macOS — coming soon</span>
              <span style={{ flex: 1, padding: "10px 14px", background: "#2a2d3e", color: "#64748b", borderRadius: 8, fontSize: 13, textAlign: "center" as const }}>Linux — coming soon</span>
            </div>
          </div>

          <h3 style={headingStyle}>Installation Guide (Windows)</h3>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>1</span>
            <div style={stepTextStyle}>
              <strong>Download the installer</strong> using the button above. Your browser may show a security warning — click <strong>"Keep"</strong> or <strong>"Download anyway"</strong> (the file is safe).
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>2</span>
            <div style={stepTextStyle}>
              <strong>Run the installer:</strong> Double-click the downloaded <strong>.exe</strong> file. Choose where to install (or keep the default) → Click <strong>Install</strong> → Wait for it to finish.
              <div style={tipStyle}>Windows SmartScreen may show a warning. Click <strong>"More info"</strong> → <strong>"Run anyway"</strong>.</div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>3</span>
            <div style={stepTextStyle}>
              <strong>Find the app:</strong> After installation, <strong>Ailancers Tracker</strong> appears in your system tray (bottom-right corner of the taskbar, near the clock). You may need to click the <strong>^</strong> arrow to see hidden icons.
              <div style={tipStyle}>The app runs silently in the background — no window to keep open. Just look for the small icon in the tray.</div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>4</span>
            <div style={stepTextStyle}>
              <strong>Login:</strong> A login window will appear automatically. Click <strong>"Login with Ailancers"</strong> to sign in via your browser (supports Google login too), or type your email and password directly.
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>5</span>
            <div style={stepTextStyle}>
              <strong>Select your project:</strong> Right-click the tray icon → <strong>"Select Project/Task..."</strong> → Choose the project and sub-project you{"'"}re working on.
              <div style={tipStyle}>You can switch projects anytime by right-clicking the tray icon again.</div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>6</span>
            <div style={stepTextStyle}>
              <strong>Done!</strong> The tracker runs automatically. It tracks:
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                <li>Active and idle time (pauses after 10 min idle)</li>
                <li>Which applications you{"'"}re using (Chrome, Excel, Slack, etc.)</li>
                <li>Screenshots every 5 minutes</li>
              </ul>
            </div>
          </div>

          <h3 style={{ ...headingStyle, marginTop: 24 }}>Daily Usage</h3>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>🔄</span>
            <div style={stepTextStyle}>
              <strong>Auto-start:</strong> The tracker starts automatically when you turn on your computer. You stay logged in for 30 days. No need to open it manually every day.
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>⏸️</span>
            <div style={stepTextStyle}>
              <strong>Pause/Resume:</strong> Right-click the tray icon to pause tracking or log out. Tracking resumes when you log back in or un-pause.
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>📊</span>
            <div style={stepTextStyle}>
              <strong>View your stats:</strong> Visit the dashboard at <strong>https://apivscode.ailancers.com/dashboard/me</strong> to see your performance, daily breakdown, and screenshots.
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* FAQ */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Frequently Asked Questions</h2>

          {[
            { q: "Which one should I download?", a: "If you use VS Code for coding → get the VS Code Extension. For everyone else (HR, design, management, admin) → get the Desktop Tracker. Both track the same data." },
            { q: "What does it track?", a: "Active time (when you're working), idle time (when you're away), which apps you use, periodic screenshots, and AI usage costs. If you're idle for 10+ minutes, tracking pauses automatically." },
            { q: "Do I need to start it every day?", a: "No. Once installed and logged in, both apps start automatically when you turn on your computer. You stay logged in for 30 days." },
            { q: "Can my manager see my screenshots?", a: "Yes. Your manager and admin can see your screenshots, active time, and activity in the dashboard. This helps with project tracking and accountability." },
            { q: "How do I change my project?", a: "VS Code: Click the 📁 icon in the status bar or Ctrl+Shift+P → 'Select Project'. Desktop: Right-click the tray icon → 'Select Project/Task'. You can switch anytime." },
            { q: "What if I forget to select a project?", a: "Your time will still be tracked but won't be attributed to any project. Select a project as soon as you remember — it will apply to future activity." },
            { q: "How do I login?", a: "Click 'Login with Ailancers' — your browser opens the Ailancers login page. Sign in with your regular Ailancers account (email, Google, etc.). The app detects your login automatically. Or type your email and password directly." },
            { q: "Where can I see my data?", a: "Visit the dashboard at https://apivscode.ailancers.com/dashboard/me — you'll see your performance, daily time, screenshots, and more." },
            { q: "How do I uninstall?", a: "VS Code: Extensions panel → find Ailancers Code → Uninstall. Desktop: Windows Settings → Apps → Ailancers Tracker → Uninstall." },
          ].map(({ q, a }) => (
            <div key={q} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#818cf8", marginBottom: 4 }}>{q}</h3>
              <p style={{ fontSize: 13, color: "#8b8d98" }}>{a}</p>
            </div>
          ))}
        </div>

        {/* Share */}
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <p style={{ color: "#8b8d98", fontSize: 13, marginBottom: 8 }}>Share this page with your team:</p>
          <button
            onClick={() => { navigator.clipboard.writeText(typeof window !== "undefined" ? window.location.href : ""); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            style={{ background: "#2a2d3e", border: "1px solid #3a3d4e", color: "#e4e4e7", padding: "8px 20px", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
          >
            {copied ? "Copied!" : "Copy Link"}
          </button>
        </div>
      </main>

      <footer style={{ textAlign: "center", padding: "24px", borderTop: "1px solid #2a2d3e", color: "#8b8d98", fontSize: 12 }}>
        Ailancers Tracker — Need help? Contact your admin or IT team.
      </footer>
    </div>
  );
}
