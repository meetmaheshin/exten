"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { DashboardShell } from "@/components/DashboardShell";
import { DateRangeFilter, dateRangePresets, dateRangeToISO, type DateRange } from "@/components/DateRangeFilter";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatDuration, formatDateTime } from "@/lib/format";

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
  // Click a date row → expand inline to show that day's screenshots. Cheaper
  // than navigating to a new page, and keeps the user's place in the table.
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [dayScreenshots, setDayScreenshots] = useState<Record<string, MyScreenshot[]>>({});

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

  // Toggle a day open/closed. Fetch its screenshots lazily on first open;
  // re-opens reuse the cached result so re-clicking is instant.
  const toggleDay = async (date: string) => {
    if (expandedDate === date) {
      setExpandedDate(null);
      return;
    }
    setExpandedDate(date);
    if (dayScreenshots[date] || !accessToken) return;
    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.999Z`;
    try {
      const resp = await apiFetch<{ data: MyScreenshot[] }>(
        `/api/telemetry/screenshots/me?limit=100&from=${from}&to=${to}`,
        { token: accessToken },
      );
      setDayScreenshots((prev) => ({ ...prev, [date]: resp.data || [] }));
    } catch (e) {
      console.error(e);
      setDayScreenshots((prev) => ({ ...prev, [date]: [] }));
    }
  };

  // Aggregate stats for the new card layout — payroll-relevant numbers,
  // computed client-side from the daily array we already fetch so no
  // backend round-trip needed.
  const daysWithAnyActivity = daily.filter((d) => d.totalActiveSeconds > 0).length;
  const daysWith8hPlus = daily.filter((d) => d.totalActiveSeconds >= 8 * 3600).length;

  // Chart data — bar per day, color-coded by hours. Reverse so oldest is on
  // the left and newest on the right (natural left-to-right reading order).
  const chartData = [...daily].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
    date: d.date,
    label: new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    hours: Math.round((d.totalActiveSeconds / 3600) * 100) / 100,
  }));
  const barColor = (hours: number) => {
    if (hours >= 6) return "var(--success)";    // green — on target
    if (hours >= 4) return "var(--warning)";    // yellow — moderate
    return "#ef5350";                            // red — low
  };

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
          {/* Today highlight — big, hard to miss, with both active + idle.
              When the user has just signed in and hasn't had a 5-min
              screenshot yet, this will read 0m for active — that's expected,
              the "Live" hint below explains why so they don't think it's
              broken. */}
          <div style={{ marginBottom: 16, padding: "14px 18px", background: "var(--bg-card)", borderRadius: 10, border: "1px solid var(--primary)", borderLeftWidth: 4, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 24 }}>
            <div style={{ minWidth: 80 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Today</div>
              <div style={{ fontSize: 13, color: "var(--primary)", fontWeight: 600 }}>
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Active</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--success)" }}>
                {formatDuration(todayData?.totalActiveSeconds ?? 0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Idle</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--warning)" }}>
                {formatDuration(todayData?.totalIdleSeconds ?? 0)}
              </div>
            </div>
            <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", maxWidth: 260, lineHeight: 1.4 }}>
              Updates every 5 min as new screenshots arrive. If you just started, your first screenshot is still pending.
            </div>
          </div>

          {/* Self-check banners — surface the same fishy/stale flags managers
              and admins see, but framed as a heads-up to the user about their
              own tracking setup. Managers will be asking about these anyway,
              so it's better for the dev to spot and fix first. */}
          {summary && summary.totalActiveSeconds >= 4 * 3600 && summary.totalIdleSeconds === 0 && (
            <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, color: "#f87171", fontSize: 13 }}>
              <strong>Heads up:</strong> your tracker reported {formatDuration(summary.totalActiveSeconds)} of active time but zero idle time in this range. That usually means the client isn't detecting idle periods correctly (anti-cheat mouse jiggler, broken OS-idle hook, or an old client build). Worth a sanity check — your manager will see this flag too.
            </div>
          )}
          {daily.length > 0 && (() => {
            const mostRecent = [...daily].sort((a, b) => b.date.localeCompare(a.date))[0];
            const days = Math.floor((Date.now() - new Date(mostRecent.date + "T00:00:00Z").getTime()) / 86_400_000);
            if (days < 7) return null;
            return (
              <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 6, color: "#facc15", fontSize: 13 }}>
                <strong>Heads up:</strong> no activity recorded for {days} days. If you've been working, your extension may have stopped tracking — restart VS Code or check the Ailancers status bar.
              </div>
            );
          })()}

          <div className="stats-grid">
            <StatCard value={formatDuration(summary?.totalActiveSeconds ?? 0)} label={`Active Time ${rangeLabel}`} color="blue" />
            <StatCard value={formatDuration(summary?.totalIdleSeconds ?? 0)} label={`Idle Time ${rangeLabel}`} color="yellow" />
            <StatCard value={String(daysWithAnyActivity)} label={`Days Logged In ${rangeLabel}`} color="green" />
            <StatCard value={String(daysWith8hPlus)} label={`Days with 8h+ ${rangeLabel}`} color="purple" />
          </div>

          {/* Daily hours chart — bar per day, color-coded by target. Green
              bars are good days, yellow are moderate, red are below target.
              Chart is a quick visual scan; the table below has the numbers. */}
          {chartData.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Active Hours per Day</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", display: "flex", gap: 12 }}>
                  <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--success)", borderRadius: 2, marginRight: 4 }} />≥6h</span>
                  <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--warning)", borderRadius: 2, marginRight: 4 }} />4–6h</span>
                  <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#ef5350", borderRadius: 2, marginRight: 4 }} />&lt;4h</span>
                </span>
              </div>
              <div style={{ padding: "12px 16px 16px" }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} unit="h" />
                    <Tooltip
                      contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                      labelStyle={{ color: "var(--text)" }}
                      formatter={(value: number) => [`${value.toFixed(2)} h`, "Active"]}
                    />
                    <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                      {chartData.map((d) => (
                        <Cell key={d.date} fill={barColor(d.hours)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Daily breakdown — click any row to expand and see that day's
              screenshots inline. Cheaper than a separate detail page and
              keeps the user's place in the table. */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">Daily Breakdown</div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Date</th><th>Active</th><th>Idle</th><th>Sessions</th><th></th></tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map((d) => {
                    const isToday = d.date === todayStr;
                    const isExpanded = expandedDate === d.date;
                    const shots = dayScreenshots[d.date];
                    return (
                      <Fragment key={d.date}>
                        <tr
                          onClick={() => toggleDay(d.date)}
                          style={{
                            background: isToday ? "rgba(99,102,241,0.06)" : isExpanded ? "rgba(99,102,241,0.04)" : undefined,
                            cursor: "pointer",
                          }}
                          title="Click to see this day's screenshots"
                        >
                          <td style={{ fontWeight: isToday ? 700 : 400 }}>
                            <span style={{ display: "inline-block", width: 14, color: "var(--text-muted)" }}>{isExpanded ? "▾" : "▸"}</span>
                            {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                            {isToday && <span style={{ marginLeft: 8, fontSize: 10, background: "var(--primary)", color: "#fff", padding: "1px 6px", borderRadius: 4 }}>Today</span>}
                          </td>
                          <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(d.totalActiveSeconds)}</td>
                          <td style={{ color: "var(--warning)" }}>{formatDuration(d.totalIdleSeconds)}</td>
                          <td>{d.sessionCount}</td>
                          <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {d.totalActiveSeconds > 0 && `${Math.round(d.totalActiveSeconds / 300)} screenshot${Math.round(d.totalActiveSeconds / 300) === 1 ? "" : "s"}`}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} style={{ padding: 16, background: "rgba(99,102,241,0.03)" }}>
                              {!shots ? (
                                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading screenshots…</div>
                              ) : shots.length === 0 ? (
                                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No screenshots for this day.</div>
                              ) : (
                                <>
                                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                                    {shots.length} screenshot{shots.length === 1 ? "" : "s"} captured —{" "}
                                    each represents ~5 min of tracked work.
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                                    {shots.map((s) => (
                                      <div key={s.id} style={{ background: "var(--bg-card)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                                        <img
                                          src={`${API_BASE}/api/telemetry/screenshots/${s.id}/image?token=${accessToken}`}
                                          alt={s.filename}
                                          style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }}
                                        />
                                        <div style={{ padding: "4px 8px", fontSize: 10, color: "var(--text-muted)" }}>
                                          {new Date(s.capturedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {daily.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>No activity recorded yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* My screenshots — recent shots + link to the full gallery */}
          <div className="card">
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>My Recent Screenshots</span>
              <Link href="/my-screenshots" className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 12px" }}>
                See all
              </Link>
            </div>
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
