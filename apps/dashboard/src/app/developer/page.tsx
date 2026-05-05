"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { DateRangeFilter, dateRangePresets, dateRangeToISO, type DateRange } from "@/components/DateRangeFilter";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatDuration, formatNumber, formatCost, formatDateTime } from "@/lib/format";

interface UserSummary {
  summary: {
    totalActiveSeconds: number;
    totalIdleSeconds: number;
    totalFileSaves: number;
    sessionCount: number;
  };
  aiUsage: {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: string;
  };
  topApps?: Array<{ name: string; seconds: number }>;
}

interface SessionWithTask {
  id: string;
  started_at: string;
  ended_at: string | null;
  active_seconds: number;
  idle_seconds: number;
  total_file_saves: number;
  project_name: string | null;
  task_name: string | null;
  os_platform: string | null;
}

interface ScreenshotEntry {
  id: string;
  filename: string;
  capturedAt: string;
  fileSizeBytes: number;
}

function DeveloperDetailContent() {
  const searchParams = useSearchParams();
  const userId = searchParams.get("id") ?? "";
  const { accessToken } = useAuth();
  const [summary, setSummary] = useState<UserSummary | null>(null);
  const [sessions, setSessions] = useState<SessionWithTask[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>(() => dateRangePresets.last30Days());

  useEffect(() => {
    if (!accessToken || !userId) return;
    setLoading(true);
    const iso = dateRangeToISO(dateRange);
    const summaryParams = new URLSearchParams();
    const sessionsParams = new URLSearchParams({ limit: "100" });
    if (iso.from) {
      summaryParams.set("from", iso.from);
      sessionsParams.set("from", iso.from);
    }
    if (iso.to) {
      summaryParams.set("to", iso.to);
      sessionsParams.set("to", iso.to);
    }
    Promise.all([
      apiFetch<UserSummary>(`/api/admin/activity/user/${userId}?${summaryParams}`, { token: accessToken }),
      apiFetch<{ data: SessionWithTask[] }>(`/api/admin/activity/user/${userId}/sessions?${sessionsParams}`, { token: accessToken }),
      apiFetch<{ data: ScreenshotEntry[] }>(`/api/admin/screenshots?userId=${userId}&limit=12`, { token: accessToken }),
    ])
      .then(([sum, sess, ss]) => {
        setSummary(sum);
        setSessions(sess.data);
        setScreenshots(ss.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, userId, dateRange.from, dateRange.to]);

  return (
    <DashboardShell>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-title">Developer Detail</div>
          <div className="page-subtitle">Activity for the selected period</div>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>
      {loading ? (
        <div className="loading">Loading developer data...</div>
      ) : summary ? (
        <>
          <div className="stats-grid">
            <StatCard value={formatDuration(summary.summary.totalActiveSeconds)} label="Active Time" color="blue" />
            <StatCard value={formatDuration(summary.summary.totalIdleSeconds)} label="Idle Time" color="yellow" />
            <StatCard value={formatNumber(summary.summary.totalFileSaves)} label="File Saves" color="green" />
            <StatCard value={String(summary.summary.sessionCount)} label="Sessions" color="purple" />
          </div>
          <div className="stats-grid">
            <StatCard value={formatNumber(summary.aiUsage.totalRequests)} label="AI Requests" color="blue" />
            <StatCard value={formatNumber(summary.aiUsage.totalInputTokens)} label="Input Tokens" color="green" />
            <StatCard value={formatNumber(summary.aiUsage.totalOutputTokens)} label="Output Tokens" color="yellow" />
            <StatCard value={formatCost(summary.aiUsage.totalCostUsd)} label="AI Cost" color="purple" />
          </div>

          {/* Top apps the user spent time in */}
          {summary.topApps && summary.topApps.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">Top Apps</div>
              <div style={{ padding: "8px 16px 16px" }}>
                {(() => {
                  const max = summary.topApps[0].seconds || 1;
                  return summary.topApps.map((a) => {
                    const pct = Math.max((a.seconds / max) * 100, 2);
                    return (
                      <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
                        <div style={{ width: 160, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.name}>{a.name}</div>
                        <div style={{ flex: 1, height: 12, background: "var(--bg-secondary)", borderRadius: 6, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "var(--primary)", borderRadius: 6 }} />
                        </div>
                        <div style={{ width: 80, textAlign: "right", fontSize: 12, color: "var(--text-muted)" }}>{formatDuration(a.seconds)}</div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* Sessions with task names */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">Recent Sessions ({sessions.length})</div>
            <div className="table-container">
              <table>
                <thead><tr>
                  <th>Started</th><th>Duration</th><th>Active</th><th>Idle</th>
                  <th>Project / Task</th><th>Saves</th>
                </tr></thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{formatDateTime(s.started_at)}</td>
                      <td>{formatDuration(s.active_seconds + s.idle_seconds)}</td>
                      <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(s.active_seconds)}</td>
                      <td style={{ color: s.idle_seconds > 0 ? "var(--warning)" : "var(--text-muted)" }}>{formatDuration(s.idle_seconds)}</td>
                      <td>
                        {s.project_name ? (
                          <div>
                            <div style={{ fontWeight: 500, color: "var(--primary)" }}>{s.project_name}</div>
                            {s.task_name && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.task_name}</div>}
                          </div>
                        ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td>{formatNumber(s.total_file_saves)}</td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>No sessions recorded</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Screenshots */}
          <div className="card">
            <div className="card-header">Recent Screenshots</div>
            {screenshots.length === 0 ? (
              <div style={{ color: "var(--text-muted)", padding: 16 }}>No screenshots captured</div>
            ) : (
              <div className="screenshots-grid">
                {screenshots.map((s) => (
                  <div key={s.id} className="screenshot-card">
                    <img src={`${API_BASE}/api/telemetry/screenshots/${s.id}/image?token=${accessToken}`} alt={s.filename}
                      style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: "8px 8px 0 0", display: "block" }} />
                    <div className="screenshot-meta">{formatDateTime(s.capturedAt)} · {Math.round(s.fileSizeBytes / 1024)} KB</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual Time Entry (Admin only) */}
          <ManualTimeEntry userId={userId} accessToken={accessToken!} />
        </>
      ) : (
        <div className="loading">No data found for this developer</div>
      )}
    </DashboardShell>
  );
}

function ManualTimeEntry({ userId, accessToken }: { userId: string; accessToken: string }) {
  const [date, setDate] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const totalSeconds = (parseInt(hours || "0") * 3600) + (parseInt(minutes || "0") * 60);
    if (!date || totalSeconds <= 0) { setResult("Enter a valid date and time"); return; }

    setSubmitting(true);
    setResult("");
    try {
      await apiFetch("/api/admin/activity/manual-entry", {
        token: accessToken,
        method: "POST",
        body: JSON.stringify({ userId, date, activeSeconds: totalSeconds, note: note || undefined }),
      });
      setResult(`Added ${hours || 0}h ${minutes || 0}m for ${date}`);
      setDate(""); setHours(""); setMinutes(""); setNote("");
    } catch (err) {
      setResult("Failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header">Add Manual Time Entry</div>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", padding: "0 0 8px" }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Date</label>
          <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} required style={{ width: 160 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Hours</label>
          <input type="number" className="form-input" value={hours} onChange={(e) => setHours(e.target.value)} min="0" max="24" placeholder="0" style={{ width: 70 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Minutes</label>
          <input type="number" className="form-input" value={minutes} onChange={(e) => setMinutes(e.target.value)} min="0" max="59" placeholder="0" style={{ width: 70 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Note (optional)</label>
          <input type="text" className="form-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for manual entry" style={{ width: 220 }} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting} style={{ height: 36 }}>
          {submitting ? "Adding..." : "Add Time"}
        </button>
      </form>
      {result && <div style={{ fontSize: 12, color: result.startsWith("Failed") ? "var(--danger)" : "var(--success)", padding: "4px 0" }}>{result}</div>}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
        Manual entries are marked with a blank screenshot and show as "manual-entry" in session source.
      </div>
    </div>
  );
}

export default function DeveloperDetailPage() {
  return (
    <Suspense fallback={<div className="loading">Loading...</div>}>
      <DeveloperDetailContent />
    </Suspense>
  );
}
