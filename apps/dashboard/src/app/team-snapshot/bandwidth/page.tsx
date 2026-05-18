"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { TeamSnapshotTabs } from "@/components/TeamSnapshotTabs";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

interface BandwidthRow {
  managerName: string;
  teamSize: number;
  workingDays: number;
  expectedHours: number;
  actualHours: number;
  occupiedPct: number;
  freePct: number;
}
interface BandwidthResponse {
  workingDays: number;
  rows: BandwidthRow[];
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function startOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday-based
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}
function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-01`;
}
function yesterdayISO(): string {
  return dateNDaysAgo(1);
}

// Matches Cattr's bandwidth report thresholds (strict 80/60). A team
// averaging only 60% of the 8h × team × days expectation goes amber;
// anything below 60% is red. Tighter than the old 50/30 thresholds.
function pctColor(pct: number): string {
  if (pct >= 80) return "#4caf50";
  if (pct >= 60) return "#ff9800";
  return "#ef5350";
}

export default function BandwidthPage() {
  const { accessToken, isManager } = useAuth();
  const [from, setFrom] = useState<string>(startOfWeek());
  const [to, setTo] = useState<string>(yesterdayISO());
  const [data, setData] = useState<BandwidthResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-load on mount + whenever the user clicks Calculate
  const fetchData = useMemo(
    () => async () => {
      if (!accessToken) return;
      setLoading(true);
      try {
        const res = await apiFetch<BandwidthResponse>(
          `/api/team-snapshot/bandwidth?from=${from}&to=${to}`,
          { token: accessToken }
        );
        setData(res);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [accessToken, from, to]
  );

  useEffect(() => {
    fetchData();
    // Only on mount + on preset clicks (which call fetchData via the preset onClick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  function applyPreset(name: "yesterday" | "week" | "month") {
    if (name === "yesterday") {
      const y = yesterdayISO();
      setFrom(y);
      setTo(y);
    } else if (name === "week") {
      setFrom(startOfWeek());
      setTo(yesterdayISO());
    } else {
      setFrom(startOfMonth());
      setTo(yesterdayISO());
    }
    // Defer the fetch so the new state is in scope
    setTimeout(fetchData, 0);
  }

  function downloadCsv() {
    if (!data) return;
    const header = ["Manager", "Team", "Working Days", "Expected Hours", "Actual Hours", "Occupied %", "Free %"];
    const lines = [header.join(",")];
    // Sort to match the on-screen order (occupancy desc), so the CSV row
    // ordering doesn't surprise the reader after the in-place sort above.
    const sortedRows = [...data.rows].sort((a, b) => b.occupiedPct - a.occupiedPct);
    for (const r of sortedRows) {
      lines.push([
        `"${r.managerName.replace(/"/g, '""')}"`,
        r.teamSize,
        r.workingDays,
        r.expectedHours,
        r.actualHours,
        r.occupiedPct,
        r.freePct,
      ].join(","));
    }
    // Append a TOTAL row — sum team sizes / expected / actual across all
    // managers in the period. Occupied% is recomputed from totals (NOT the
    // mean of per-manager %, which would be wrong for unequal team sizes).
    const totalTeam = sortedRows.reduce((s, r) => s + r.teamSize, 0);
    const totalExpected = sortedRows.reduce((s, r) => s + r.expectedHours, 0);
    const totalActual = Math.round(sortedRows.reduce((s, r) => s + r.actualHours, 0) * 10) / 10;
    const totalOccupied = totalExpected > 0 ? Math.round((totalActual / totalExpected) * 1000) / 10 : 0;
    const totalFree = Math.max(0, Math.round((100 - totalOccupied) * 10) / 10);
    lines.push([
      "TOTAL",
      totalTeam,
      sortedRows[0]?.workingDays ?? 0,
      totalExpected,
      totalActual,
      totalOccupied,
      totalFree,
    ].join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bandwidth-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!isManager) {
    return (
      <DashboardShell>
        <div className="page-header">
          <div className="page-title">Bandwidth Report</div>
        </div>
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          This page is for managers and admins.
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <TeamSnapshotTabs />

      <div className="page-header">
        <div>
          <div className="page-title">Bandwidth Report</div>
          <div className="page-subtitle">Per-manager team utilization vs the 8h × people × working-days expectation</div>
        </div>
      </div>

      {/* Filter row */}
      <div className="card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={controlLabelStyle}>
          From date
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} max={todayISO()} />
        </label>
        <label style={controlLabelStyle}>
          To date
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} max={todayISO()} />
        </label>
        <button onClick={fetchData} className="btn btn-primary" style={{ height: 36 }}>📊 Calculate</button>
        <button onClick={downloadCsv} className="btn btn-secondary" style={{ height: 36 }} disabled={!data || data.rows.length === 0}>📥 Download CSV</button>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => applyPreset("yesterday")} className="btn btn-secondary" style={{ padding: "6px 14px" }}>Yesterday</button>
          <button onClick={() => applyPreset("week")} className="btn btn-secondary" style={{ padding: "6px 14px" }}>This Week</button>
          <button onClick={() => applyPreset("month")} className="btn btn-secondary" style={{ padding: "6px 14px" }}>This Month</button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading bandwidth report…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          No bandwidth data for this range.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
            🗓️ {from} to {to} · {data.workingDays} working days (weekends excluded)
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
              <thead>
                <tr style={{ background: "var(--bg-secondary)" }}>
                  <th style={thStyle}>Manager</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Team</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Days</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Expected</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Actual</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Occupied %</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Free %</th>
                  <th style={{ ...thStyle, textAlign: "left", minWidth: 200 }}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {/* Sort occupancy desc — fully-utilized teams at the top,
                    under-utilized at the bottom. Matches Cattr. */}
                {[...data.rows].sort((a, b) => b.occupiedPct - a.occupiedPct).map((r) => {
                  const barColor = pctColor(r.occupiedPct);
                  const width = Math.min(100, Math.max(0, r.occupiedPct));
                  return (
                    <tr key={r.managerName}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.managerName}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>{r.teamSize}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>{r.workingDays}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{r.expectedHours}h</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{r.actualHours.toFixed(1)}h</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: barColor, fontWeight: 700 }}>
                        {r.occupiedPct.toFixed(1)}%
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "var(--text-muted)" }}>
                        {r.freePct.toFixed(1)}%
                      </td>
                      <td style={tdStyle}>
                        <div style={{ height: 10, background: "var(--bg-secondary)", borderRadius: 5, overflow: "hidden", minWidth: 160 }}>
                          <div style={{ width: `${width}%`, height: "100%", background: barColor, borderRadius: 5 }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  borderBottom: "1px solid var(--border)",
  fontWeight: 600,
  fontSize: 11,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const controlLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  fontSize: 11,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 600,
  gap: 4,
};

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  background: "var(--bg-card)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 13,
  textTransform: "none",
  fontWeight: 400,
};
