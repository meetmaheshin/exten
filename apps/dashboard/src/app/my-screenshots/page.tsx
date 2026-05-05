"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { DateRangeFilter, dateRangePresets, type DateRange } from "@/components/DateRangeFilter";
import { useAuth } from "@/lib/auth";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface Screenshot {
  id: string;
  filename: string;
  fileSizeBytes: number;
  capturedAt: string;
}

const PAGE_SIZE = 100;

export default function MyScreenshotsPage() {
  const { accessToken } = useAuth();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Default to today's range so users land on the current day's captures
  const [dateRange, setDateRange] = useState<DateRange>(() => dateRangePresets.today());

  // Initial / filter-driven load
  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: "0" });
    if (dateRange.from) params.set("from", `${dateRange.from}T00:00:00.000Z`);
    if (dateRange.to) params.set("to", `${dateRange.to}T23:59:59.999Z`);
    apiFetch<{ data: Screenshot[]; total?: number }>(
      `/api/telemetry/screenshots/me?${params}`,
      { token: accessToken }
    )
      .then((res) => {
        setScreenshots(res.data || []);
        setTotal(res.total ?? (res.data?.length ?? 0));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, dateRange.from, dateRange.to]);

  const loadMore = () => {
    if (!accessToken) return;
    setLoadingMore(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(screenshots.length),
    });
    if (dateRange.from) params.set("from", `${dateRange.from}T00:00:00.000Z`);
    if (dateRange.to) params.set("to", `${dateRange.to}T23:59:59.999Z`);
    apiFetch<{ data: Screenshot[]; total?: number }>(
      `/api/telemetry/screenshots/me?${params}`,
      { token: accessToken }
    )
      .then((res) => {
        setScreenshots((prev) => [...prev, ...(res.data || [])]);
        if (res.total !== undefined) setTotal(res.total);
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false));
  };

  const selectedIndex = selectedId ? screenshots.findIndex((s) => s.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? screenshots[selectedIndex] : undefined;
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < screenshots.length - 1;
  const goPrev = useCallback(() => {
    if (hasPrev) setSelectedId(screenshots[selectedIndex - 1].id);
  }, [hasPrev, screenshots, selectedIndex]);
  const goNext = useCallback(() => {
    if (hasNext) setSelectedId(screenshots[selectedIndex + 1].id);
  }, [hasNext, screenshots, selectedIndex]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, goPrev, goNext]);

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">My Screenshots</div>
          <div className="page-subtitle">
            {total > 0 ? `Showing ${screenshots.length} of ${total} screenshots` : `${screenshots.length} screenshots`}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <DateRangeFilter value={dateRange} onChange={setDateRange} showAllTime />
      </div>

      {/* Lightbox */}
      {selectedId && (
        <div
          onClick={() => setSelectedId(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
          }}
        >
          {hasPrev && (
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              aria-label="Previous screenshot"
              style={{
                position: "absolute", left: 24, top: "50%", transform: "translateY(-50%)",
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(255,255,255,0.15)", color: "#fff",
                border: "none", cursor: "pointer", fontSize: 24,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              &#8249;
            </button>
          )}
          {hasNext && (
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              aria-label="Next screenshot"
              style={{
                position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)",
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(255,255,255,0.15)", color: "#fff",
                border: "none", cursor: "pointer", fontSize: 24,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              &#8250;
            </button>
          )}
          <img
            src={`${API_BASE}/api/telemetry/screenshots/${selectedId}/image?token=${accessToken}`}
            alt="Screenshot" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "80vh", borderRadius: 8 }}
          />
          {selected && (
            <div style={{ color: "#fff", marginTop: 12, fontSize: 13, opacity: 0.7, textAlign: "center" }}>
              {formatDateTime(selected.capturedAt)} &middot; {Math.round(selected.fileSizeBytes / 1024)} KB
              {selectedIndex >= 0 && (
                <>
                  &nbsp;&middot;&nbsp;{selectedIndex + 1} / {screenshots.length}
                </>
              )}
              <br />
              <span style={{ fontSize: 11 }}>Use &larr; &rarr; arrow keys, Esc to close</span>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading screenshots...</div>
      ) : screenshots.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          No screenshots captured yet.
        </div>
      ) : (
        <>
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

          {screenshots.length < total && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
              <button className="btn btn-secondary" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading..." : `Load more (${screenshots.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
