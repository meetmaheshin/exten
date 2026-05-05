"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { DateRangeFilter, dateRangePresets, dateRangeToISO, type DateRange } from "@/components/DateRangeFilter";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDuration, formatNumber } from "@/lib/format";

interface DailyData {
  date: string;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalFileSaves: number;
  activeDevelopers: number;
  sessionCount: number;
}

interface DateDetail {
  user_id: string;
  full_name: string;
  email: string;
  total_active_seconds: number;
  total_idle_seconds: number;
  total_file_saves: number;
  session_count: number;
  project_names: string | null;
  task_names: string | null;
}

export default function ActivityPage() {
  const { accessToken } = useAuth();
  const [daily, setDaily] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dateDetail, setDateDetail] = useState<DateDetail[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>(() => dateRangePresets.last30Days());

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const iso = dateRangeToISO(dateRange);
    const params = new URLSearchParams({ limit: "60" });
    if (iso.from) params.set("from", iso.from);
    if (iso.to) params.set("to", iso.to);
    apiFetch<{ data: DailyData[] }>(
      `/api/admin/activity/daily?${params}`,
      { token: accessToken }
    )
      .then((res) => setDaily(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, dateRange.from, dateRange.to]);

  async function loadDateDetail(date: string) {
    if (!accessToken) return;
    if (selectedDate === date) { setSelectedDate(null); return; }
    setSelectedDate(date);
    setDetailLoading(true);
    try {
      const res = await apiFetch<{ data: DateDetail[] }>(`/api/admin/activity/date/${date}`, { token: accessToken });
      setDateDetail(res.data);
    } catch (e) { console.error(e); }
    finally { setDetailLoading(false); }
  }

  const totalActive = daily.reduce((s, d) => s + d.totalActiveSeconds, 0);
  const totalIdle = daily.reduce((s, d) => s + d.totalIdleSeconds, 0);
  const totalSessions = daily.reduce((s, d) => s + d.sessionCount, 0);
  const maxActive = Math.max(...daily.map((d) => d.totalActiveSeconds), 1);

  return (
    <DashboardShell>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-title">Daily Activity</div>
          <div className="page-subtitle">Time tracked per day across the team — click any date for the per-user breakdown</div>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      <div className="stats-grid">
        <StatCard value={formatDuration(totalActive)} label="Total Active Time" color="blue" />
        <StatCard value={formatDuration(totalIdle)} label="Total Idle Time" color="yellow" />
        <StatCard value={String(totalSessions)} label="Total Sessions" color="purple" />
        <StatCard value={String(daily.length)} label="Days Tracked" color="green" />
      </div>

      <div className="card">
        <div className="card-header">Daily Active Time</div>
        {loading ? (
          <div className="loading">Loading activity data...</div>
        ) : (
          <>
            {/* Bar chart */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 180, padding: "16px 0" }}>
              {daily.map((d) => {
                const pct = Math.max((d.totalActiveSeconds / maxActive) * 100, 2);
                const dateLabel = new Date(d.date).toLocaleDateString("en", { month: "short", day: "numeric" });
                const isSelected = selectedDate === d.date;
                return (
                  <div key={d.date} onClick={() => loadDateDetail(d.date)}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", cursor: "pointer" }}>
                    <div style={{
                      width: "100%", maxWidth: 28, height: `${pct}%`,
                      background: isSelected ? "var(--primary)" : "var(--accent-blue)",
                      borderRadius: "4px 4px 0 0", minHeight: 2,
                      border: isSelected ? "2px solid var(--primary-hover)" : "none",
                      transition: "background 0.2s",
                    }}
                      title={`${dateLabel}: ${formatDuration(d.totalActiveSeconds)} active, ${d.activeDevelopers} devs`} />
                    <div style={{ fontSize: 9, color: isSelected ? "var(--primary)" : "var(--text-muted)", marginTop: 4, textAlign: "center", fontWeight: isSelected ? 700 : 400 }}>
                      {dateLabel}
                    </div>
                  </div>
                );
              })}
              {daily.length === 0 && (
                <div style={{ width: "100%", textAlign: "center", color: "var(--text-muted)" }}>No data yet</div>
              )}
            </div>

            {/* Date detail drill-down */}
            {selectedDate && (
              <div style={{ marginTop: 16, padding: 16, background: "var(--bg-secondary)", borderRadius: 8, border: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 700, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
                  <button className="btn btn-secondary" onClick={() => setSelectedDate(null)} style={{ padding: "2px 10px", fontSize: 12 }}>Close</button>
                </div>
                {detailLoading ? <div className="loading">Loading...</div> : (
                  <table><thead><tr>
                    <th>Developer</th><th>Active</th><th>Idle</th><th>Saves</th><th>Sessions</th><th>Projects</th><th>Tasks</th>
                  </tr></thead><tbody>
                    {dateDetail.map(d => (
                      <tr key={d.user_id}>
                        <td><strong>{d.full_name}</strong><br /><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.email}</span></td>
                        <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(d.total_active_seconds)}</td>
                        <td style={{ color: "var(--warning)" }}>{formatDuration(d.total_idle_seconds)}</td>
                        <td>{formatNumber(d.total_file_saves)}</td>
                        <td>{d.session_count}</td>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.project_names || "—"}</td>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.task_names || "—"}</td>
                      </tr>
                    ))}
                    {dateDetail.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>No activity on this date</td></tr>
                    )}
                  </tbody></table>
                )}
              </div>
            )}

            {/* Daily table */}
            <div className="table-container" style={{ marginTop: 16 }}>
              <table>
                <thead><tr>
                  <th>Date</th><th>Active Time</th><th>Idle Time</th><th>Saves</th><th>Active Devs</th><th>Sessions</th>
                </tr></thead>
                <tbody>
                  {[...daily].reverse().map((d) => {
                    const isSelected = selectedDate === d.date;
                    return (
                      <tr key={d.date} onClick={() => loadDateDetail(d.date)}
                        style={{ cursor: "pointer", background: isSelected ? "var(--primary)15" : undefined }}>
                        <td style={{ fontWeight: isSelected ? 700 : 400, color: isSelected ? "var(--primary)" : undefined }}>
                          {new Date(d.date).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}
                        </td>
                        <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(d.totalActiveSeconds)}</td>
                        <td style={{ color: "var(--warning)" }}>{formatDuration(d.totalIdleSeconds)}</td>
                        <td>{formatNumber(d.totalFileSaves)}</td>
                        <td>{d.activeDevelopers}</td>
                        <td>{d.sessionCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
