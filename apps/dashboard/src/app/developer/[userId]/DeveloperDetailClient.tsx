"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDuration, formatNumber, formatCost, formatDateTime } from "@/lib/format";

interface UserDetail {
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
  sessions: Array<{
    id: string;
    startedAt: string;
    endedAt: string | null;
    activeSeconds: number;
    idleSeconds: number;
    totalKeystrokes: number;
    totalFileSaves: number;
  }>;
}

interface ScreenshotEntry {
  id: string;
  filename: string;
  capturedAt: string;
  fileSizeBytes: number;
  metadata: Record<string, unknown>;
}

export default function DeveloperDetailPage() {
  const params = useParams();
  const userId = params.userId as string;
  const { accessToken } = useAuth();
  const [data, setData] = useState<UserDetail | null>(null);
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken || !userId) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    Promise.all([
      apiFetch<UserDetail>(
        `/api/admin/activity/user/${userId}?from=${thirtyDaysAgo.toISOString()}`,
        { token: accessToken }
      ),
      apiFetch<{ data: ScreenshotEntry[] }>(
        `/api/admin/screenshots?userId=${userId}&limit=12`,
        { token: accessToken }
      ),
    ])
      .then(([detail, screenshotRes]) => {
        setData(detail);
        setScreenshots(screenshotRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, userId]);

  return (
    <DashboardShell>
      <div className="page-header">
        <div className="page-title">Developer Detail</div>
        <div className="page-subtitle">Last 30 days activity for user {userId.slice(0, 8)}...</div>
      </div>

      {loading ? (
        <div className="loading">Loading developer data...</div>
      ) : data ? (
        <>
          <div className="stats-grid">
            <StatCard value={formatDuration(data.summary.totalActiveSeconds)} label="Active Time" color="blue" />
            <StatCard value={formatDuration(data.summary.totalIdleSeconds)} label="Idle Time" color="yellow" />
            <StatCard value={formatNumber(data.summary.totalKeystrokes)} label="Keystrokes" color="green" />
            <StatCard value={formatNumber(data.summary.totalFileSaves)} label="File Saves" color="purple" />
          </div>

          <div className="stats-grid">
            <StatCard value={formatNumber(data.aiUsage.totalRequests)} label="AI Requests" color="blue" />
            <StatCard value={formatNumber(data.aiUsage.totalInputTokens)} label="Input Tokens" color="green" />
            <StatCard value={formatNumber(data.aiUsage.totalOutputTokens)} label="Output Tokens" color="yellow" />
            <StatCard value={formatCost(data.aiUsage.totalCostUsd)} label="AI Cost" color="purple" />
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">Recent Sessions</div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Active</th>
                    <th>Idle</th>
                    <th>Keystrokes</th>
                    <th>Saves</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{formatDateTime(s.startedAt)}</td>
                      <td>{formatDuration(s.activeSeconds + s.idleSeconds)}</td>
                      <td>{formatDuration(s.activeSeconds)}</td>
                      <td>{formatDuration(s.idleSeconds)}</td>
                      <td>{formatNumber(s.totalKeystrokes)}</td>
                      <td>{formatNumber(s.totalFileSaves)}</td>
                    </tr>
                  ))}
                  {data.sessions.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>
                        No sessions recorded
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Recent Screenshots</div>
            {screenshots.length === 0 ? (
              <div style={{ color: "var(--text-muted)", padding: 16 }}>No screenshots captured</div>
            ) : (
              <div className="screenshots-grid">
                {screenshots.map((s) => (
                  <div key={s.id} className="screenshot-card">
                    <div className="screenshot-meta">
                      {formatDateTime(s.capturedAt)} &middot; {Math.round(s.fileSizeBytes / 1024)} KB
                    </div>
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
