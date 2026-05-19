"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { DateRangeFilter, dateRangePresets, type DateRange } from "@/components/DateRangeFilter";
import { useAuth } from "@/lib/auth";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface Screenshot {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  filename: string;
  fileSizeBytes: number;
  capturedAt: string;
  metadata: Record<string, unknown>;
  sessionId: string | null;
}

interface User {
  id: string;
  email: string;
  fullName: string;
}

// Diagnostic replay response shape from POST /api/dashboard/test-sync.
// On success the backend returns 200 with ok:true; on push failure it also
// returns 200 but with ok:false so this UI can render the upstream error
// instead of choking on a non-2xx — see tracker.routes.ts.
interface TestSyncResult {
  ok?: boolean;
  took_ms?: number;
  slot_id?: string;
  screenshot_id?: string;
  screenshot_url?: string;
  chat_ui_response?: unknown;
  upstream_status?: number | null;
  upstream_body?: string | null;
  message?: string;
  error?: string;
  captured_at?: string;
}

export default function ScreenshotsPage() {
  const { accessToken } = useAuth();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Default to today's date range so admins land on the current day's captures
  const [dateRange, setDateRange] = useState<DateRange>(() => dateRangePresets.today());
  const [filterUserId, setFilterUserId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestSyncResult | null>(null);

  const PAGE_SIZE = 100;

  useEffect(() => {
    if (!accessToken) return;
    apiFetch<{ data: User[] }>("/api/admin/users", { token: accessToken })
      .then((res) => setUsers(res.data))
      .catch(console.error);
  }, [accessToken]);

  const loadScreenshots = useCallback(
    (append = false) => {
      if (!accessToken) return;
      const offset = append ? screenshots.length : 0;
      if (append) setLoadingMore(true);
      else setLoading(true);

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (filterUserId) params.set("userId", filterUserId);
      if (dateRange.from) params.set("from", `${dateRange.from}T00:00:00.000Z`);
      if (dateRange.to) params.set("to", `${dateRange.to}T23:59:59.999Z`);
      apiFetch<{ data: Screenshot[]; total: number; limit: number; offset: number }>(
        `/api/admin/screenshots?${params}`,
        { token: accessToken }
      )
        .then((res) => {
          setTotal(res.total ?? res.data.length);
          if (append) {
            setScreenshots((prev) => [...prev, ...res.data]);
          } else {
            setScreenshots(res.data);
            setSelectedIds(new Set());
          }
        })
        .catch(console.error)
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [accessToken, filterUserId, dateRange.from, dateRange.to, screenshots.length]
  );

  // Reset + reload when filters change. Keep this dep list narrow so we don't
  // re-run when screenshots.length changes (which would cause infinite reloads).
  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: "0",
    });
    if (filterUserId) params.set("userId", filterUserId);
    if (dateRange.from) params.set("from", `${dateRange.from}T00:00:00.000Z`);
    if (dateRange.to) params.set("to", `${dateRange.to}T23:59:59.999Z`);
    apiFetch<{ data: Screenshot[]; total: number; limit: number; offset: number }>(
      `/api/admin/screenshots?${params}`,
      { token: accessToken }
    )
      .then((res) => {
        setTotal(res.total ?? res.data.length);
        setScreenshots(res.data);
        setSelectedIds(new Set());
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, filterUserId, dateRange.from, dateRange.to]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === screenshots.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(screenshots.map((s) => s.id)));
    }
  };

  const deleteSingle = async (id: string) => {
    if (!accessToken || !confirm("Delete this screenshot?")) return;
    try {
      await apiFetch(`/api/admin/screenshots/${id}`, { token: accessToken, method: "DELETE" });
      setScreenshots((prev) => prev.filter((s) => s.id !== id));
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      if (selectedId === id) setSelectedId(null);
    } catch (e) {
      alert("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const deleteSelected = async () => {
    if (!accessToken || selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} screenshot${selectedIds.size !== 1 ? "s" : ""}?`)) return;
    setDeleting(true);
    try {
      await apiFetch("/api/admin/screenshots/bulk-delete", {
        token: accessToken,
        method: "POST",
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      setScreenshots((prev) => prev.filter((s) => !selectedIds.has(s.id)));
      setSelectedIds(new Set());
    } catch (e) {
      alert("Bulk delete failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeleting(false);
    }
  };

  // Diagnostic: replay the caller's most recent screenshot's snapshot through
  // the same push pipeline the per-slot timer uses. chat-ui dedups by slot_id
  // so re-pushing an existing slot is billing-safe. The backend may return
  // 404/409 for the "no screenshots"/"not an hourly slot" cases — those are
  // diagnostic results we want to surface, not exceptions, so we fetch
  // directly instead of going through apiFetch.
  const runTestSync = async () => {
    if (!accessToken) return;
    setTesting(true);
    setTestResult(null);
    try {
      // When admin has filtered to a specific user, replay THAT user's slot.
      // Without it, the backend falls back to the caller's own screenshots.
      const qs = filterUserId ? `?userId=${encodeURIComponent(filterUserId)}` : "";
      const resp = await fetch(`${API_BASE}/api/dashboard/test-sync${qs}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const text = await resp.text();
      let parsed: TestSyncResult;
      try {
        parsed = JSON.parse(text) as TestSyncResult;
      } catch {
        parsed = { message: text || `HTTP ${resp.status}` };
      }
      // 200 with ok flag handled by backend; 4xx → render with implicit ok:false
      if (!resp.ok && parsed.ok === undefined) parsed.ok = false;
      setTestResult(parsed);
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const deleteAllForUser = async () => {
    if (!accessToken || !filterUserId) return;
    const userName = users.find((u) => u.id === filterUserId)?.fullName || filterUserId.slice(0, 8);
    if (!confirm(`Delete ALL screenshots for ${userName}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/screenshots/user/${filterUserId}`, {
        token: accessToken,
        method: "DELETE",
      });
      loadScreenshots(false);
    } catch (e) {
      alert("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeleting(false);
    }
  };

  const selectedScreenshot = screenshots.find((s) => s.id === selectedId);
  const selectedIndex = selectedId ? screenshots.findIndex((s) => s.id === selectedId) : -1;
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < screenshots.length - 1;
  const goPrev = useCallback(() => {
    if (hasPrev) setSelectedId(screenshots[selectedIndex - 1].id);
  }, [hasPrev, screenshots, selectedIndex]);
  const goNext = useCallback(() => {
    if (hasNext) setSelectedId(screenshots[selectedIndex + 1].id);
  }, [hasNext, screenshots, selectedIndex]);

  // Keyboard navigation for the lightbox
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
          <div className="page-title">Screenshots</div>
          <div className="page-subtitle">
            Screen captures from all developers
            {total > 0 && ` (showing ${screenshots.length} of ${total})`}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select className="form-input" value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
          ))}
        </select>
        <DateRangeFilter value={dateRange} onChange={setDateRange} showAllTime />
        {(filterUserId || dateRange.from || dateRange.to) && (
          <button className="btn btn-secondary" onClick={() => { setFilterUserId(""); setDateRange({ from: "", to: "" }); }}>
            Clear filters
          </button>
        )}

        {/* Delete actions */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={runTestSync}
            disabled={testing}
            style={{ fontSize: 12 }}
            title={
              filterUserId
                ? `Re-push the latest hourly-tracker slot for ${users.find((u) => u.id === filterUserId)?.fullName || "selected user"}. Safe — chat-ui dedups by slot_id.`
                : "Re-push your own latest hourly-tracker slot through chat-ui. Safe — chat-ui dedups by slot_id."
            }
          >
            {testing
              ? "Testing..."
              : filterUserId
                ? `Test sync (${(users.find((u) => u.id === filterUserId)?.fullName || "user").split(" ")[0]})`
                : "Test sync"}
          </button>
          {screenshots.length > 0 && (
            <button className="btn btn-secondary" onClick={selectAll} style={{ fontSize: 12 }}>
              {selectedIds.size === screenshots.length ? "Deselect All" : "Select All"}
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              className="btn"
              onClick={deleteSelected}
              disabled={deleting}
              style={{ fontSize: 12, background: "var(--danger)", color: "#fff", border: "none" }}
            >
              {deleting ? "Deleting..." : `Delete ${selectedIds.size} selected`}
            </button>
          )}
          {filterUserId && screenshots.length > 0 && (
            <button
              className="btn"
              onClick={deleteAllForUser}
              disabled={deleting}
              style={{ fontSize: 12, background: "var(--danger)", color: "#fff", border: "none", opacity: 0.8 }}
            >
              Delete all for user
            </button>
          )}
        </div>
      </div>

      {/* Test sync result modal */}
      {testResult && (
        <div
          onClick={() => setTestResult(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg, #fff)", color: "var(--text, #111)",
              borderRadius: 8, maxWidth: 640, width: "100%", maxHeight: "85vh",
              overflow: "auto", padding: 20, boxShadow: "0 8px 48px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {testResult.ok ? "✓ Sync OK" : "✗ Sync failed"}
                {typeof testResult.took_ms === "number" && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted)", fontWeight: 400 }}>
                    ({testResult.took_ms} ms)
                  </span>
                )}
              </div>
              <button onClick={() => setTestResult(null)} className="btn btn-secondary" style={{ fontSize: 12 }}>Close</button>
            </div>
            {testResult.message && (
              <div style={{ fontSize: 13, marginBottom: 12, padding: 10, background: "var(--bg-subtle, #f5f5f5)", borderRadius: 6 }}>
                {testResult.message}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12 }}>
              {testResult.slot_id && (<><span style={{ color: "var(--text-muted)" }}>slot_id</span><code>{testResult.slot_id}</code></>)}
              {testResult.screenshot_id && (<><span style={{ color: "var(--text-muted)" }}>screenshot_id</span><code>{testResult.screenshot_id}</code></>)}
              {testResult.screenshot_url && (<><span style={{ color: "var(--text-muted)" }}>screenshot_url</span><code style={{ wordBreak: "break-all" }}>{testResult.screenshot_url}</code></>)}
              {testResult.captured_at && (<><span style={{ color: "var(--text-muted)" }}>captured_at</span><span>{formatDateTime(testResult.captured_at)}</span></>)}
              {testResult.upstream_status != null && (<><span style={{ color: "var(--text-muted)" }}>upstream_status</span><code>{testResult.upstream_status}</code></>)}
              {testResult.error && (<><span style={{ color: "var(--text-muted)" }}>error</span><span>{testResult.error}</span></>)}
            </div>
            {testResult.upstream_body && (
              <details style={{ marginTop: 12, fontSize: 12 }}>
                <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>upstream_body</summary>
                <pre style={{ marginTop: 6, padding: 10, background: "var(--bg-subtle, #f5f5f5)", borderRadius: 6, overflow: "auto", maxHeight: 200 }}>
                  {testResult.upstream_body}
                </pre>
              </details>
            )}
            {testResult.chat_ui_response !== undefined && testResult.chat_ui_response !== null && (
              <details style={{ marginTop: 12, fontSize: 12 }} open>
                <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>chat_ui_response</summary>
                <pre style={{ marginTop: 6, padding: 10, background: "var(--bg-subtle, #f5f5f5)", borderRadius: 6, overflow: "auto", maxHeight: 240 }}>
                  {JSON.stringify(testResult.chat_ui_response, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {selectedId && (
        <div
          onClick={() => setSelectedId(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            zIndex: 1000, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", cursor: "zoom-out",
          }}
        >
          {/* Prev button */}
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
                backdropFilter: "blur(8px)",
              }}
            >
              &#8249;
            </button>
          )}
          {/* Next button */}
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
                backdropFilter: "blur(8px)",
              }}
            >
              &#8250;
            </button>
          )}
          <img
            src={`${API_BASE}/api/telemetry/screenshots/${selectedId}/image?token=${accessToken}`}
            alt="Screenshot"
            style={{ maxWidth: "90vw", maxHeight: "75vh", borderRadius: 8, boxShadow: "0 8px 48px rgba(0,0,0,0.6)" }}
            onClick={(e) => e.stopPropagation()}
          />
          {selectedScreenshot && (
            <div style={{ color: "#fff", marginTop: 12, fontSize: 13, opacity: 0.7, textAlign: "center" }}>
              <strong style={{ opacity: 1 }}>{selectedScreenshot.userName || selectedScreenshot.userEmail || selectedScreenshot.userId.slice(0, 8)}</strong>
              &nbsp;&middot;&nbsp;{formatDateTime(selectedScreenshot.capturedAt)}
              &nbsp;&middot;&nbsp;{Math.round(selectedScreenshot.fileSizeBytes / 1024)} KB
              {selectedIndex >= 0 && (
                <>
                  &nbsp;&middot;&nbsp;{selectedIndex + 1} / {screenshots.length}
                </>
              )}
              <br />
              <button
                onClick={(e) => { e.stopPropagation(); deleteSingle(selectedId); }}
                style={{ marginTop: 8, background: "rgba(239,68,68,0.8)", color: "#fff", border: "none", padding: "6px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
              >
                Delete this screenshot
              </button>
              <br />
              <span style={{ fontSize: 11 }}>Use &larr; &rarr; arrow keys, Esc to close</span>
            </div>
          )}
        </div>
      )}

      {/* Grid */}
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
          {screenshots.map((s) => {
            const isSelected = selectedIds.has(s.id);
            return (
              <div key={s.id} className="screenshot-card" style={{ position: "relative", border: isSelected ? "2px solid var(--primary)" : "2px solid transparent" }}>
                {/* Checkbox */}
                <div
                  onClick={(e) => { e.stopPropagation(); toggleSelect(s.id); }}
                  style={{
                    position: "absolute", top: 6, left: 6, zIndex: 2,
                    width: 22, height: 22, borderRadius: 4,
                    background: isSelected ? "var(--primary)" : "rgba(0,0,0,0.5)",
                    border: "2px solid rgba(255,255,255,0.5)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", fontSize: 14, color: "#fff",
                  }}
                >
                  {isSelected ? "\u2713" : ""}
                </div>
                {/* Delete button */}
                <div
                  onClick={(e) => { e.stopPropagation(); deleteSingle(s.id); }}
                  style={{
                    position: "absolute", top: 6, right: 6, zIndex: 2,
                    width: 22, height: 22, borderRadius: 4,
                    background: "rgba(239,68,68,0.8)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", fontSize: 12, color: "#fff",
                    opacity: 0.7, transition: "opacity 0.2s",
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.opacity = "1"; }}
                  onMouseOut={(e) => { e.currentTarget.style.opacity = "0.7"; }}
                  title="Delete"
                >
                  &#10005;
                </div>
                <img
                  src={`${API_BASE}/api/telemetry/screenshots/${s.id}/image?token=${accessToken}`}
                  alt={s.filename}
                  onClick={() => setSelectedId(s.id)}
                  style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: "6px 6px 0 0", display: "block", cursor: "pointer" }}
                />
                <div className="screenshot-meta">
                  <div style={{ fontWeight: 500, marginBottom: 2 }}>
                    {s.userName || s.userEmail || s.userId.slice(0, 8)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {formatDateTime(s.capturedAt)} &middot; {Math.round(s.fileSizeBytes / 1024)} KB
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Load more */}
      {!loading && screenshots.length > 0 && screenshots.length < total && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <button
            className="btn btn-secondary"
            disabled={loadingMore}
            onClick={() => loadScreenshots(true)}
          >
            {loadingMore ? "Loading..." : `Load more (${screenshots.length} of ${total})`}
          </button>
        </div>
      )}
    </DashboardShell>
  );
}
