"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface Screenshot {
  id: string;
  filename: string;
  fileSizeBytes: number;
  capturedAt: string;
}

export default function MyScreenshotsPage() {
  const { accessToken } = useAuth();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (filterDate) {
      params.set("from", `${filterDate}T00:00:00.000Z`);
      params.set("to", `${filterDate}T23:59:59.999Z`);
    }
    apiFetch<{ data: Screenshot[] }>(`/api/telemetry/screenshots/me?${params}`, { token: accessToken })
      .then((res) => setScreenshots(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, filterDate]);

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">My Screenshots</div>
          <div className="page-subtitle">{screenshots.length} screenshots</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12 }}>
        <input type="date" className="form-input" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} style={{ maxWidth: 180 }} />
        {filterDate && (
          <button className="btn btn-secondary" onClick={() => setFilterDate("")}>Clear</button>
        )}
      </div>

      {/* Lightbox */}
      {selectedId && (
        <div onClick={() => setSelectedId(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
        }}>
          <img
            src={`${API_BASE}/api/telemetry/screenshots/${selectedId}/image?token=${accessToken}`}
            alt="Screenshot" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 8 }}
          />
        </div>
      )}

      {loading ? (
        <div className="loading">Loading screenshots...</div>
      ) : screenshots.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          No screenshots captured yet.
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
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {formatDateTime(s.capturedAt)} · {Math.round(s.fileSizeBytes / 1024)} KB
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
