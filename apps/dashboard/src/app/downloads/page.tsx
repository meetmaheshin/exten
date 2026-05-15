"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

// GitHub Releases — stable permalinks. The /releases/latest/download/ pattern
// always serves the most recent release's asset, so we never have to update
// these URLs again. Just publish a new release with the same asset filenames.
//
// To release:
//   1) Build artifacts locally (pnpm run package, etc.)
//   2) Run scripts/release.sh <version> — uploads to GitHub
// Repo: https://github.com/dmahaesh/ailancers-code
const RELEASES_BASE = "https://github.com/dmahaesh/ailancers-code/releases/latest/download";
const VSIX_URL = `${RELEASES_BASE}/ailancers-code.vsix`;
const DESKTOP_WIN_URL = `${RELEASES_BASE}/Ailancers-Tracker-Setup.exe`;
const DESKTOP_LINUX_DEB_URL = `${RELEASES_BASE}/ailancers-tracker-x64.deb`;
const DESKTOP_LINUX_TARGZ_URL = `${RELEASES_BASE}/ailancers-tracker-x64.tar.gz`;

interface VersionResponse {
  extension: { version: string };
  desktop:   { version: string };
}

const sectionStyle = { background: "#1c1e2e", borderRadius: 12, border: "1px solid #2a2d3e", padding: 28, marginBottom: 24 };
const headingStyle = { fontSize: 16, fontWeight: 700 as const, color: "#818cf8", marginBottom: 16 };
const stepNumStyle = { display: "inline-flex" as const, alignItems: "center" as const, justifyContent: "center" as const, width: 24, height: 24, borderRadius: "50%", background: "#6366f1", color: "#fff", fontSize: 12, fontWeight: 700 as const, marginRight: 10, flexShrink: 0 };
const stepRowStyle = { display: "flex", alignItems: "flex-start" as const, gap: 0, marginBottom: 14 };
const stepTextStyle = { fontSize: 13, color: "#c4c4cc", lineHeight: 1.6 };
const tipStyle = { fontSize: 12, color: "#94a3b8", background: "#0f0f23", padding: "8px 12px", borderRadius: 6, marginTop: 6, borderLeft: "3px solid #6366f1" };
const kbdStyle = { display: "inline-block", background: "#0f0f23", border: "1px solid #334155", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontFamily: "monospace", color: "#e4e4e7" };

export default function DownloadsPage() {
  const [copied, setCopied] = useState(false);
  const [versions, setVersions] = useState<VersionResponse | null>(null);

  // Pull live version numbers from /api/version so the page never lies about
  // what users are about to download — even if we forget to bump a string here.
  useEffect(() => {
    fetch(`${API_BASE}/api/version`)
      .then((r) => (r.ok ? r.json() as Promise<VersionResponse> : null))
      .then((v) => v && setVersions(v))
      .catch(() => { /* leave versions=null, badges hide */ });
  }, []);

  const extVersion = versions?.extension.version;
  const dtVersion = versions?.desktop.version;

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
        {/* VS CODE EXTENSION — hidden per product decision. Flip SHOW_VSCODE */}
        {/* back to true to restore. Section is intentionally kept inline so   */}
        {/* /api/version + RELEASES_BASE constants and the install steps don't */}
        {/* bit-rot while it's off.                                            */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {false && (
        <div style={sectionStyle}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 36 }}>💻</span>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                VS Code Extension
                {extVersion && (
                  <span style={{ fontSize: 11, fontWeight: 600, background: "#22c55e22", color: "#4ade80", padding: "2px 8px", borderRadius: 4, letterSpacing: 0.3 }}>
                    v{extVersion}
                  </span>
                )}
              </h2>
              <p style={{ color: "#8b8d98", fontSize: 13, margin: 0 }}>For developers and engineers who use VS Code</p>
            </div>
          </div>
          <div style={{ display: "inline-block", background: "#6366f120", color: "#818cf8", fontSize: 11, padding: "2px 8px", borderRadius: 4, marginBottom: 20 }}>
            Developers, Engineers
          </div>

          {/* Download */}
          <a href={VSIX_URL} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "#6366f1", color: "white", borderRadius: 8, fontWeight: 600, fontSize: 15, textDecoration: "none", marginBottom: 24 }}>
            <span>⬇ Download VS Code Extension (.vsix){extVersion ? ` v${extVersion}` : ""}</span>
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
                Open VS Code → Press <span style={kbdStyle}>Ctrl+Shift+P</span> (or <span style={kbdStyle}>Cmd+Shift+P</span> on Mac) → Type <strong>"Install from VSIX"</strong> → Select the downloaded file → Click <strong>Install</strong>.
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>4</span>
            <div style={stepTextStyle}>
              <strong>Reload VS Code</strong> — required for the new code to load.
              <div style={tipStyle}>
                Click the blue <strong>Restart Extensions</strong> button if VS Code shows it,
                OR fully close VS Code and reopen it. Without this, the extension shows up but
                runs the old version (you{"'"}ll get an outdated email/password popup instead of the proper login).
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>5</span>
            <div style={stepTextStyle}>
              <strong>Open the AI chat panel:</strong> after restart, the Ailancers sidebar should auto-open. If not:
              <div style={tipStyle}>
                Press <span style={kbdStyle}>Ctrl+Shift+P</span> → type <strong>"Ailancers: Open Chat"</strong> → Enter.
                <br />
                Or click the <strong>"Sign in to Ailancers"</strong> button in the bottom-left status bar.
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>6</span>
            <div style={stepTextStyle}>
              <strong>Login:</strong> in the Ailancers chat panel, click <strong>"Login with Ailancers"</strong> — your browser will open for authentication. Sign in with your Ailancers account (Google, email, etc). The extension will auto-detect your login.
              <div style={tipStyle}>
                Alternatively, type your email and password directly in the extension{"'"}s login form.
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>7</span>
            <div style={stepTextStyle}>
              <strong>Select your project:</strong> Click the <strong>📁 Select Project</strong> button in the bottom status bar, or press <span style={kbdStyle}>Ctrl+Shift+P</span> → <strong>"Ailancers: Select Project"</strong>. Pick the project and sub-project you{"'"}re working on.
              <div style={tipStyle}>You can switch projects anytime. All your activity will be tagged to the selected project for billing and reporting.</div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>8</span>
            <div style={stepTextStyle}>
              <strong>Start working!</strong> Tracking starts automatically. The extension tracks:
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                <li>Active and idle time</li>
                <li>File saves and project activity</li>
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
        )}

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* DESKTOP TRACKER */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={sectionStyle}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 36 }}>🖥️</span>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                Desktop Tracker
                {dtVersion && (
                  <span style={{ fontSize: 11, fontWeight: 600, background: "#22c55e22", color: "#4ade80", padding: "2px 8px", borderRadius: 4, letterSpacing: 0.3 }}>
                    v{dtVersion}
                  </span>
                )}
              </h2>
              <p style={{ color: "#8b8d98", fontSize: 13, margin: 0 }}>For HR, admins, designers, managers — anyone not using VS Code</p>
            </div>
          </div>
          <div style={{ display: "inline-block", background: "#6366f120", color: "#818cf8", fontSize: 11, padding: "2px 8px", borderRadius: 4, marginBottom: 20 }}>
            Non-developers, All teams
          </div>

          {/* Downloads */}
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, marginBottom: 24 }}>
            <a href={DESKTOP_WIN_URL} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "#6366f1", color: "white", borderRadius: 8, fontWeight: 600, fontSize: 15, textDecoration: "none" }}>
              <span>⬇ Download for Windows (.exe){dtVersion ? ` v${dtVersion}` : ""}</span>
              <span style={{ fontSize: 12, opacity: 0.8 }}>~80 MB</span>
            </a>
            <a href={DESKTOP_LINUX_DEB_URL} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "#6366f1", color: "white", borderRadius: 8, fontWeight: 600, fontSize: 15, textDecoration: "none" }}>
              <span>⬇ Download for Linux — Ubuntu/Debian (.deb){dtVersion ? ` v${dtVersion}` : ""}</span>
              <span style={{ fontSize: 12, opacity: 0.8 }}>~75 MB</span>
            </a>
            <a href={DESKTOP_LINUX_TARGZ_URL} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "#2a2d3e", color: "#e4e4e7", borderRadius: 8, fontWeight: 500, fontSize: 14, textDecoration: "none", border: "1px solid #3a3d4e" }}>
              <span>⬇ Download for Linux — other distros (.tar.gz){dtVersion ? ` v${dtVersion}` : ""}</span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>~110 MB</span>
            </a>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ flex: 1, padding: "10px 14px", background: "#2a2d3e", color: "#64748b", borderRadius: 8, fontSize: 13, textAlign: "center" as const }}>macOS — coming soon</span>
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

          {/* ─── Linux install ─── */}
          <h3 style={{ ...headingStyle, marginTop: 32 }}>Installation Guide (Linux)</h3>

          <div style={tipStyle}>
            <strong>Pick the right file:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li><strong>.deb</strong> — Ubuntu, Debian, Linux Mint, Pop!_OS, elementary OS</li>
              <li><strong>.tar.gz</strong> — Fedora, Arch, openSUSE, or any other distro</li>
            </ul>
          </div>

          <h4 style={{ fontSize: 13, fontWeight: 700, color: "#c4c4cc", marginTop: 16, marginBottom: 8 }}>Option A: Ubuntu / Debian (.deb)</h4>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>1</span>
            <div style={stepTextStyle}>
              <strong>Download the .deb file</strong> using the button above. It will save to your <span style={kbdStyle}>~/Downloads</span> folder by default.
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>2</span>
            <div style={stepTextStyle}>
              <strong>Open a terminal</strong> (<span style={kbdStyle}>Ctrl+Alt+T</span> on Ubuntu) and install with apt:
              <div style={tipStyle}>
                <code>cd ~/Downloads</code><br />
                <code>sudo apt install ./ailancers-tracker-x64.deb</code>
              </div>
              This pulls in any missing dependencies automatically (Electron runtime, GTK libraries, etc.).
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>3</span>
            <div style={stepTextStyle}>
              <strong>Recommended (for full per-app tracking):</strong> install <code>xdotool</code> and <code>xprintidle</code> if you don{"'"}t already have them:
              <div style={tipStyle}>
                <code>sudo apt install xdotool xprintidle</code>
              </div>
              Without these, idle detection still works but the tracker can{"'"}t see which app you have focused (so the "Top Apps" chart will be empty).
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>4</span>
            <div style={stepTextStyle}>
              <strong>Launch:</strong> Open your application launcher and search for <strong>"Ailancers Tracker"</strong>, or run from terminal:
              <div style={tipStyle}>
                <code>ailancers-tracker</code>
              </div>
              The icon appears in your top-bar / system tray (depends on desktop environment — GNOME requires the <strong>AppIndicator</strong> extension to show tray icons).
            </div>
          </div>

          <h4 style={{ fontSize: 13, fontWeight: 700, color: "#c4c4cc", marginTop: 20, marginBottom: 8 }}>Option B: Other distros (.tar.gz)</h4>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>1</span>
            <div style={stepTextStyle}>
              <strong>Download and extract</strong> the .tar.gz anywhere you like. <span style={kbdStyle}>~/apps</span> is a common choice:
              <div style={tipStyle}>
                <code>mkdir -p ~/apps && cd ~/apps</code><br />
                <code>tar xzf ~/Downloads/ailancers-tracker-x64.tar.gz</code>
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>2</span>
            <div style={stepTextStyle}>
              <strong>Install runtime dependencies</strong> (only the names differ between distros):
              <div style={tipStyle}>
                <strong>Fedora:</strong> <code>sudo dnf install xdotool xprintidle libnotify</code><br />
                <strong>Arch:</strong> <code>sudo pacman -S xdotool xprintidle libnotify</code><br />
                <strong>openSUSE:</strong> <code>sudo zypper install xdotool xprintidle libnotify</code>
              </div>
              <code>libnotify</code> is needed for the "Screenshot captured" toast. <code>xdotool</code> + <code>xprintidle</code> are recommended for per-app tracking.
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>3</span>
            <div style={stepTextStyle}>
              <strong>Launch:</strong>
              <div style={tipStyle}>
                <code>cd ~/apps/ailancers-tracker-*-x64</code><br />
                <code>./ailancers-tracker</code>
              </div>
              The extracted folder includes the version (e.g. <code>ailancers-tracker-0.1.0-x64</code>) — the shell glob above matches whatever version you downloaded.
              <br /><br />
              For convenience, create a symlink so you can run it from anywhere:
              <div style={tipStyle}>
                <code>{"sudo ln -s ~/apps/ailancers-tracker-*-x64/ailancers-tracker /usr/local/bin/ailancers-tracker"}</code>
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>4</span>
            <div style={stepTextStyle}>
              <strong>Auto-start on login (optional):</strong> create a desktop entry that runs the tracker on boot:
              <div style={tipStyle}>
                <code>mkdir -p ~/.config/autostart</code><br />
                <code>{"cat > ~/.config/autostart/ailancers-tracker.desktop <<'EOF'"}</code><br />
                <code>[Desktop Entry]</code><br />
                <code>Type=Application</code><br />
                <code>Name=Ailancers Tracker</code><br />
                <code>Exec=/usr/local/bin/ailancers-tracker</code><br />
                <code>X-GNOME-Autostart-enabled=true</code><br />
                <code>EOF</code>
              </div>
            </div>
          </div>

          <div style={stepRowStyle}>
            <span style={stepNumStyle}>5</span>
            <div style={stepTextStyle}>
              <strong>After launch, the rest is the same as Windows:</strong> login window appears → "Login with Ailancers" → pick project → done. View your stats at <strong>https://apivscode.ailancers.com/dashboard/me</strong>.
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
            { q: "What does it track?", a: "Active time (when you're working), idle time (when you're away), which apps you use, periodic screenshots, and AI usage costs. If you're idle for 10+ minutes, tracking pauses automatically." },
            { q: "Do I need to start it every day?", a: "No. Once installed and logged in, the tracker starts automatically when you turn on your computer. You stay logged in for 30 days." },
            { q: "Can my manager see my screenshots?", a: "Yes. Your manager and admin can see your screenshots, active time, and activity in the dashboard. This helps with project tracking and accountability." },
            { q: "How do I change my project?", a: "Right-click the tray icon → 'Select Project/Task'. You can switch anytime." },
            { q: "What if I forget to select a project?", a: "Your time will still be tracked but won't be attributed to any project. Select a project as soon as you remember — it will apply to future activity." },
            { q: "How do I login?", a: "Click 'Login with Ailancers' — your browser opens the Ailancers login page. Sign in with your regular Ailancers account (email, Google, etc.). The app detects your login automatically. Or type your email and password directly." },
            { q: "Where can I see my data?", a: "Visit the dashboard at https://apivscode.ailancers.com/dashboard/me — you'll see your performance, daily time, screenshots, and more." },
            { q: "How do I uninstall?", a: "Windows Settings → Apps → Ailancers Tracker → Uninstall." },
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
