"use client";

import { useState } from "react";

// Google Drive direct-download URLs
const VSIX_URL = "https://drive.google.com/uc?export=download&id=1fEHytm4817ligiYhucoiSUHKFEdYnlVX";
const DESKTOP_WIN_URL = "https://drive.google.com/uc?export=download&id=1pqb46xDO6fzA0M_KcQL9gbCxw6ut6As3";

interface DownloadCard {
  title: string;
  subtitle: string;
  icon: string;
  audience: string;
  downloads: Array<{
    label: string;
    url: string;
    platform: string;
    size?: string;
  }>;
  steps: string[];
}

const cards: DownloadCard[] = [
  {
    title: "VS Code Extension",
    subtitle: "For developers who use VS Code daily",
    icon: "💻",
    audience: "Developers, Engineers",
    downloads: [
      { label: "Download .vsix", url: VSIX_URL, platform: "all", size: "~450 KB" },
    ],
    steps: [
      "Install VS Code if you don't have it",
      "Download the .vsix file above",
      "Open VS Code → Ctrl+Shift+P → \"Install from VSIX\" → select the file",
      "Click the Ailancers icon in the sidebar → Login with your work email",
      "Done! Tracking starts automatically",
    ],
  },
  {
    title: "Desktop Tracker",
    subtitle: "For everyone else — HR, admins, designers, managers",
    icon: "🖥️",
    audience: "Non-developers, All teams",
    downloads: [
      { label: "Download for Windows", url: DESKTOP_WIN_URL, platform: "windows", size: "~106 MB" },
      { label: "Download for macOS (coming soon)", url: "#", platform: "mac", size: "~90 MB" },
      { label: "Download for Linux (coming soon)", url: "#", platform: "linux", size: "~85 MB" },
    ],
    steps: [
      "Download the installer for your operating system",
      "Run the installer — follow the prompts",
      "The app appears in your system tray (bottom-right on Windows)",
      "Click the tray icon → Login with your work email",
      "Done! Tracking runs in the background automatically",
    ],
  },
];

export default function DownloadsPage() {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e4e4e7" }}>
      {/* Header */}
      <header style={{
        padding: "40px 24px 32px",
        textAlign: "center",
        borderBottom: "1px solid #2a2d3e",
        background: "linear-gradient(180deg, #161822 0%, #0f1117 100%)",
      }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>
          <span style={{ color: "#6366f1", fontWeight: 800 }}>Ailancers</span>{" "}
          <span style={{ fontWeight: 300 }}>Tracker</span>
        </div>
        <p style={{ color: "#8b8d98", fontSize: 16, maxWidth: 500, margin: "0 auto" }}>
          Download and install the activity tracker for your platform. Takes less than 2 minutes.
        </p>
      </header>

      {/* Cards */}
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {cards.map((card) => (
            <div key={card.title} style={{
              background: "#1c1e2e",
              borderRadius: 12,
              border: "1px solid #2a2d3e",
              padding: 28,
              display: "flex",
              flexDirection: "column",
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{card.icon}</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{card.title}</h2>
              <p style={{ color: "#8b8d98", fontSize: 13, marginBottom: 4 }}>{card.subtitle}</p>
              <div style={{
                display: "inline-block",
                background: "#6366f120",
                color: "#818cf8",
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                marginBottom: 20,
                alignSelf: "flex-start",
              }}>
                {card.audience}
              </div>

              {/* Download buttons */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
                {card.downloads.map((dl) => {
                  const isDisabled = dl.url === "#";
                  return (
                    <a
                      key={dl.label}
                      href={dl.url}
                      onClick={(e) => { if (isDisabled) e.preventDefault(); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 16px",
                        background: isDisabled ? "#2a2d3e" : "#6366f1",
                        color: isDisabled ? "#64748b" : "white",
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 14,
                        textDecoration: "none",
                        transition: "background 0.2s",
                        cursor: isDisabled ? "not-allowed" : "pointer",
                      }}
                      onMouseOver={(e) => { if (!isDisabled) e.currentTarget.style.background = "#4f46e5"; }}
                      onMouseOut={(e) => { if (!isDisabled) e.currentTarget.style.background = "#6366f1"; }}
                    >
                      <span>⬇ {dl.label}</span>
                      {dl.size && <span style={{ fontSize: 11, opacity: 0.8 }}>{dl.size}</span>}
                    </a>
                  );
                })}
              </div>

              {/* Steps */}
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "#8b8d98", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Setup Steps
                </h3>
                <ol style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                  {card.steps.map((step, i) => (
                    <li key={i} style={{ fontSize: 13, color: "#c4c4cc", lineHeight: 1.5 }}>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ))}
        </div>

        {/* FAQ Section */}
        <div style={{ marginTop: 48, background: "#1c1e2e", borderRadius: 12, border: "1px solid #2a2d3e", padding: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Frequently Asked Questions</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#818cf8", marginBottom: 4 }}>
                Which one should I download?
              </h3>
              <p style={{ fontSize: 13, color: "#8b8d98" }}>
                If you use VS Code for coding, get the <strong style={{ color: "#e4e4e7" }}>VS Code Extension</strong>.
                For everyone else (HR, design, management, admin), get the <strong style={{ color: "#e4e4e7" }}>Desktop Tracker</strong>.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#818cf8", marginBottom: 4 }}>
                What does it track?
              </h3>
              <p style={{ fontSize: 13, color: "#8b8d98" }}>
                Active time, idle time, which applications you use, and periodic screenshots.
                If you're idle for 10+ minutes, tracking pauses automatically.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#818cf8", marginBottom: 4 }}>
                Do I need to start it every day?
              </h3>
              <p style={{ fontSize: 13, color: "#8b8d98" }}>
                No. Once installed and logged in, the tracker starts automatically when you turn on your computer.
                You stay logged in for 30 days. Just open your computer and start working.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#818cf8", marginBottom: 4 }}>
                How do I select my project/task?
              </h3>
              <p style={{ fontSize: 13, color: "#8b8d98" }}>
                <strong style={{ color: "#e4e4e7" }}>VS Code:</strong> Click the project icon in the status bar (bottom-left) or press Ctrl+Shift+P → "Select Project".<br />
                <strong style={{ color: "#e4e4e7" }}>Desktop:</strong> Right-click the tray icon → "Select Project/Task".
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#818cf8", marginBottom: 4 }}>
                What are my login credentials?
              </h3>
              <p style={{ fontSize: 13, color: "#8b8d98" }}>
                Use your work email address. Your admin has created your account.
                If you don't have a password, contact your admin.
              </p>
            </div>
          </div>
        </div>

        {/* Share link */}
        <div style={{ marginTop: 32, textAlign: "center" }}>
          <p style={{ color: "#8b8d98", fontSize: 13, marginBottom: 8 }}>
            Share this page with your team:
          </p>
          <button
            onClick={() => copyToClipboard(typeof window !== "undefined" ? window.location.href : "")}
            style={{
              background: "#2a2d3e",
              border: "1px solid #3a3d4e",
              color: "#e4e4e7",
              padding: "8px 20px",
              borderRadius: 6,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {copied ? "Copied!" : "Copy Link"}
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ textAlign: "center", padding: "24px", borderTop: "1px solid #2a2d3e", color: "#8b8d98", fontSize: 12 }}>
        Ailancers Tracker — Need help? Contact your admin or IT team.
      </footer>
    </div>
  );
}
