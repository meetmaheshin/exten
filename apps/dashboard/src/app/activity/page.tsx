"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDuration, formatNumber } from "@/lib/format";

interface DailyData {
  date: string;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalKeystrokes: number;
  activeDevelopers: number;
  sessionCount: number;
}

export default function ActivityPage() {
  const { accessToken } = useAuth();
  const [daily, setDaily] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    apiFetch<{ data: DailyData[] }>(
      `/api/admin/activity/daily?from=${thirtyDaysAgo.toISOString()}&limit=30`,
      { token: accessToken }
    )
      .then((res) => setDaily(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  const totalActive = daily.reduce((s, d) => s + d.totalActiveSeconds, 0);
  const totalKeystrokes = daily.reduce((s, d) => s + d.totalKeystrokes, 0);
  const totalSessions = daily.reduce((s, d) => s + d.sessionCount, 0);
  const maxActive = Math.max(...daily.map((d) => d.totalActiveSeconds), 1);

  return (
    <DashboardShell>
      <div className="page-header">
        <div className="page-title">Team Activity</div>
        <div className="page-subtitle">Daily activity breakdown for the last 30 days</div>
      </div>

      <div className="stats-grid">
        <StatCard value={formatDuration(totalActive)} label="Total Active Time" color="blue" />
        <StatCard value={formatNumber(totalKeystrokes)} label="Total Keystrokes" color="green" />
        <StatCard value={String(totalSessions)} label="Total Sessions" color="purple" />
        <StatCard value={String(daily.length)} label="Days Tracked" color="yellow" />
      </div>

      <div className="card">
        <div className="card-header">Daily Active Time</div>
        {loading ? (
          <div className="loading">Loading activity data...</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 180, padding: "16px 0" }}>
              {daily.map((d) => {
                const pct = Math.max((d.totalActiveSeconds / maxActive) * 100, 2);
                const dateLabel = new Date(d.date).toLocaleDateString("en", { month: "short", day: "numeric" });
                return (
                  <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 28,
                        height: `${pct}%`,
                        background: "var(--accent-blue)",
                        borderRadius: "4px 4px 0 0",
                        minHeight: 2,
                      }}
                      title={`${dateLabel}: ${formatDuration(d.totalActiveSeconds)} active, ${d.activeDevelopers} devs`}
                    />
                    <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4, textAlign: "center" }}>
                      {dateLabel}
                    </div>
                  </div>
                );
              })}
              {daily.length === 0 && (
                <div style={{ width: "100%", textAlign: "center", color: "var(--text-muted)" }}>
                  No data yet
                </div>
              )}
            </div>

            <div className="table-container" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Active Time</th>
                    <th>Idle Time</th>
                    <th>Keystrokes</th>
                    <th>Active Devs</th>
                    <th>Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map((d) => (
                    <tr key={d.date}>
                      <td>{new Date(d.date).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}</td>
                      <td>{formatDuration(d.totalActiveSeconds)}</td>
                      <td>{formatDuration(d.totalIdleSeconds)}</td>
                      <td>{formatNumber(d.totalKeystrokes)}</td>
                      <td>{d.activeDevelopers}</td>
                      <td>{d.sessionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
