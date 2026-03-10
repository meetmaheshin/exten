"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface Screenshot {
  id: string;
  userId: string;
  filename: string;
  fileSizeBytes: number;
  capturedAt: string;
  metadata: Record<string, unknown>;
  sessionId: string | null;
}

export default function ScreenshotsPage() {
  const { accessToken } = useAuth();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    apiFetch<{ data: Screenshot[] }>("/api/admin/screenshots?limit=50", {
      token: accessToken,
    })
      .then((res) => setScreenshots(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

  return (
    <DashboardShell>
      <div className="page-header">
        <div className="page-title">Screenshots</div>
        <div className="page-subtitle">Screen captures from all developers</div>
      </div>

      {loading ? (
        <div className="loading">Loading screenshots...</div>
      ) : screenshots.length === 0 ? (
        <div className="card">
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 48 }}>
            No screenshots captured yet. Screenshots are taken automatically when developers have screen capture enabled.
          </div>
        </div>
      ) : (
        <>
          {selectedId && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.8)",
                zIndex: 100,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
              onClick={() => setSelectedId(null)}
            >
              <img
                src={`${apiBase}/api/telemetry/screenshots/${selectedId}/image?token=${accessToken}`}
                alt="Screenshot"
                style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8 }}
              />
            </div>
          )}

          <div className="screenshots-grid">
            {screenshots.map((s) => (
              <div
                key={s.id}
                className="screenshot-card"
                onClick={() => setSelectedId(s.id)}
              >
                <div style={{ background: "var(--bg)", padding: 32, textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
                  {s.filename}
                </div>
                <div className="screenshot-meta">
                  {formatDateTime(s.capturedAt)} &middot; {Math.round(s.fileSizeBytes / 1024)} KB
                  <br />
                  User: {s.userId.slice(0, 8)}...
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </DashboardShell>
  );
}
