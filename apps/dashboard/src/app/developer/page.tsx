"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatDuration, formatNumber, formatCost, formatDateTime } from "@/lib/format";

interface UserSummary {
  summary: {
    totalActiveSeconds: number;
    totalIdleSeconds: number;
    totalKeystrokes: number;
    totalFileSaves: number;
    sessionCount: number;
  };
  aiUsage: {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: string;
  };
}

interface SessionWithTask {
  id: string;
  started_at: string;
  ended_at: string | null;
  active_seconds: number;
  idle_seconds: number;
  total_keystrokes: number;
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

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromParam = thirtyDaysAgo.toISOString();

  useEffect(() => {
    if (!accessToken || !userId) return;
    Promise.all([
      apiFetch<UserSummary>(`/api/admin/activity/user/${userId}?from=${fromParam}`, { token: accessToken }),
      apiFetch<{ data: SessionWithTask[] }>(`/api/admin/activity/user/${userId}/sessions?from=${fromParam}&limit=100`, { token: accessToken }),
      apiFetch<{ data: ScreenshotEntry[] }>(`/api/admin/screenshots?userId=${userId}&limit=12`, { token: accessToken }),
    ])
      .then(([sum, sess, ss]) => {
        setSummary(sum);
        setSessions(sess.data);
        setScreenshots(ss.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, userId]);

  return (
    <DashboardShell>
      <div className="page-header">
        <div className="page-title">Developer Detail</div>
        <div className="page-subtitle">Last 30 days activity</div>
      </div>
      {loading ? (
        <div className="loading">Loading developer data...</div>
      ) : summary ? (
        <>
          <div className="stats-grid">
            <StatCard value={formatDuration(summary.summary.totalActiveSeconds)} label="Active Time" color="blue" />
            <StatCard value={formatDuration(summary.summary.totalIdleSeconds)} label="Idle Time" color="yellow" />
            <StatCard value={formatNumber(summary.summary.totalKeystrokes)} label="Keystrokes" color="green" />
            <StatCard value={formatNumber(summary.summary.totalFileSaves)} label="File Saves" color="purple" />
          </div>
          <div className="stats-grid">
            <StatCard value={formatNumber(summary.aiUsage.totalRequests)} label="AI Requests" color="blue" />
            <StatCard value={formatNumber(summary.aiUsage.totalInputTokens)} label="Input Tokens" color="green" />
            <StatCard value={formatNumber(summary.aiUsage.totalOutputTokens)} label="Output Tokens" color="yellow" />
            <StatCard value={formatCost(summary.aiUsage.totalCostUsd)} label="AI Cost" color="purple" />
          </div>

          {/* Sessions with task names */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">Recent Sessions ({sessions.length})</div>
            <div className="table-container">
              <table>
                <thead><tr>
                  <th>Started</th><th>Duration</th><th>Active</th><th>Idle</th>
                  <th>Project / Task</th><th>Keystrokes</th><th>Saves</th>
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
                      <td>{formatNumber(s.total_keystrokes)}</td>
                      <td>{formatNumber(s.total_file_saves)}</td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>No sessions recorded</td></tr>
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
        </>
      ) : (
        <div className="loading">No data found for this developer</div>
      )}
    </DashboardShell>
  );
}

export default function DeveloperDetailPage() {
  return (
    <Suspense fallback={<div className="loading">Loading...</div>}>
      <DeveloperDetailContent />
    </Suspense>
  );
}
