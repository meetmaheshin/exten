"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { DateRangeFilter, dateRangePresets, dateRangeToISO, type DateRange } from "@/components/DateRangeFilter";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatDuration, formatNumber, formatCost, formatDateTime } from "@/lib/format";

interface MySummary {
  totalSessions: number;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalFileSaves: number;
}

interface MyDaily {
  date: string;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalFileSaves: number;
  sessionCount: number;
}

interface MyScreenshot {
  id: string;
  filename: string;
  fileSizeBytes: number;
  capturedAt: string;
}

export default function MyPerformancePage() {
  const { accessToken, user } = useAuth();
  const [summary, setSummary] = useState<MySummary | null>(null);
  const [daily, setDaily] = useState<MyDaily[]>([]);
  const [screenshots, setScreenshots] = useState<MyScreenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>(() => dateRangePresets.last30Days());

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const iso = dateRangeToISO(dateRange);
    const summaryParams = new URLSearchParams();
    const dailyParams = new URLSearchParams({ limit: "60" });
    if (iso.from) {
      summaryParams.set("from", iso.from);
      dailyParams.set("from", iso.from);
    }
    if (iso.to) {
      summaryParams.set("to", iso.to);
      dailyParams.set("to", iso.to);
    }
    Promise.all([
      apiFetch<{ data: MySummary }>(`/api/activity/me/summary?${summaryParams}`, { token: accessToken }),
      apiFetch<{ data: MyDaily[] }>(`/api/activity/me/daily?${dailyParams}`, { token: accessToken }),
      apiFetch<{ data: MyScreenshot[] }>("/api/telemetry/screenshots/me?limit=8", { token: accessToken }),
    ])
      .then(([sum, d, ss]) => {
        setSummary(sum.data);
        setDaily(d.data || []);
        setScreenshots(ss.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, dateRange.from, dateRange.to]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayData = daily.find((d) => d.date === todayStr);

  // Label e.g. "(30d)" used in stat-card sublabels
  const rangeLabel = (() => {
    if (!dateRange.from && !dateRange.to) return "(all time)";
    if (dateRange.from && dateRange.to) {
      const from = new Date(dateRange.from);
      const to = new Date(dateRange.to);
      if (dateRange.from === dateRange.to) return "(today)";
      const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
      return `(${days}d)`;
    }
    return "";
  })();

  return (
    <DashboardShell>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-title">My Performance</div>
          <div className="page-subtitle">
            Welcome back, {user?.fullName}
          </div>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} showAllTime />
      </div>

      {loading ? (
        <div className="loading">Loading your data...</div>
      ) : (
        <>
          {/* Today highlight */}
          {todayData && (
            <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--bg-card)", borderRadius: 8, border: "1px solid var(--primary)", borderLeftWidth: 3 }}>
              <strong style={{ color: "var(--primary)" }}>Today</strong>
              <span style={{ marginLeft: 16 }}>Active: <strong style={{ color: "var(--success)" }}>{formatDuration(todayData.totalActiveSeconds)}</strong></span>
              <span style={{ marginLeft: 16 }}>Idle: <strong style={{ color: "var(--warning)" }}>{formatDuration(todayData.totalIdleSeconds)}</strong></span>
              <span style={{ marginLeft: 16 }}>Sessions: <strong>{todayData.sessionCount}</strong></span>
            </div>
          )}

          <div className="stats-grid">
            <StatCard value={formatDuration(summary?.totalActiveSeconds ?? 0)} label={`Active Time ${rangeLabel}`} color="blue" />
            <StatCard value={formatDuration(summary?.totalIdleSeconds ?? 0)} label={`Idle Time ${rangeLabel}`} color="yellow" />
            <StatCard value={formatNumber(summary?.totalFileSaves ?? 0)} label={`File Saves ${rangeLabel}`} color="green" />
            <StatCard value={String(summary?.totalSessions ?? 0)} label="Sessions" color="purple" />
          </div>

          {/* Daily breakdown */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">Daily Breakdown</div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Date</th><th>Active</th><th>Idle</th><th>Saves</th><th>Sessions</th></tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map((d) => {
                    const isToday = d.date === todayStr;
                    return (
                      <tr key={d.date} style={isToday ? { background: "var(--primary)10" } : {}}>
                        <td style={{ fontWeight: isToday ? 700 : 400 }}>
                          {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                          {isToday && <span style={{ marginLeft: 8, fontSize: 10, background: "var(--primary)", color: "#fff", padding: "1px 6px", borderRadius: 4 }}>Today</span>}
                        </td>
                        <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(d.totalActiveSeconds)}</td>
                        <td style={{ color: "var(--warning)" }}>{formatDuration(d.totalIdleSeconds)}</td>
                        <td>{formatNumber(d.totalFileSaves)}</td>
                        <td>{d.sessionCount}</td>
                      </tr>
                    );
                  })}
                  {daily.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>No activity recorded yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* My screenshots */}
          <div className="card">
            <div className="card-header">My Recent Screenshots</div>
            {screenshots.length === 0 ? (
              <div style={{ padding: 24, color: "var(--text-muted)", textAlign: "center" }}>No screenshots yet</div>
            ) : (
              <div className="screenshots-grid">
                {screenshots.map((s) => (
                  <div key={s.id} className="screenshot-card">
                    <img
                      src={`${API_BASE}/api/telemetry/screenshots/${s.id}/image?token=${accessToken}`}
                      alt={s.filename}
                      style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: "8px 8px 0 0", display: "block" }}
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
          </div>
        </>
      )}
    </DashboardShell>
  );
}
