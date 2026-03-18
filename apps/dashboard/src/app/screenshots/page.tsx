"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch, API_BASE } from "@/lib/api";
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
    apiFetch<{ data: Screenshot[] }>("/api/admin/screenshots?limit=100", { token: accessToken })
      .then((res) => setScreenshots(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  const selectedScreenshot = screenshots.find((s) => s.id === selectedId);

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">Screenshots</div>
          <div className="page-subtitle">Screen captures from all developers ({screenshots.length} total)</div>
        </div>
      </div>

      {selectedId && (
        <div
          onClick={() => setSelectedId(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            zIndex: 1000, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", cursor: "zoom-out",
          }}
        >
          <img
            src={`${API_BASE}/api/telemetry/screenshots/${selectedId}/image?token=${accessToken}`}
            alt="Screenshot"
            style={{ maxWidth: "90vw", maxHeight: "80vh", borderRadius: 8, boxShadow: "0 8px 48px rgba(0,0,0,0.6)" }}
            onClick={(e) => e.stopPropagation()}
          />
          {selectedScreenshot && (
            <div style={{ color: "#fff", marginTop: 12, fontSize: 13, opacity: 0.7, textAlign: "center" }}>
              {formatDateTime(selectedScreenshot.capturedAt)} &nbsp;·&nbsp;
              {Math.round(selectedScreenshot.fileSizeBytes / 1024)} KB &nbsp;·&nbsp;
              User: {selectedScreenshot.userId.slice(0, 8)}...
              <br />
              <span style={{ fontSize: 11 }}>Click anywhere to close</span>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading screenshots...</div>
      ) : screenshots.length === 0 ? (
        <div className="card">
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 48 }}>
            No screenshots captured yet.
          </div>
        </div>
      ) : (
        <div className="screenshots-grid">
          {screenshots.map((s) => (
            <div key={s.id} className="screenshot-card" onClick={() => setSelectedId(s.id)} style={{ cursor: "pointer" }}>
              <img
                src={`${API_BASE}/api/telemetry/screenshots/${s.id}/image?token=${accessToken}`}
                alt={s.filename}
                style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: "8px 8px 0 0", display: "block" }}
              />
              <div className="screenshot-meta">
                <div style={{ fontWeight: 500, marginBottom: 2 }}>{s.filename}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {formatDateTime(s.capturedAt)} · {Math.round(s.fileSizeBytes / 1024)} KB
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>User: {s.userId.slice(0, 8)}...</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
