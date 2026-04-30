"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

// ─── Types matching the /api/team-snapshot response ───
interface DateCell {
  activeSeconds: number;
  kind: "data" | "no-data" | "weekend";
}
interface SnapshotEmployee {
  userId: string;
  fullName: string;
  email: string;
  atdSeconds: number;
  isAllManual: boolean;
  perDate: Record<string, DateCell>;
}
interface SnapshotGroup {
  managerId: string | null;
  managerName: string;
  headerAtdSeconds: number;
  teamBandwidthPct: number;
  perDateTeamAvgSeconds: Record<string, number>;
  employees: SnapshotEmployee[];
}
interface SnapshotResponse {
  dates: string[];
  groups: SnapshotGroup[];
}

// ─── Helpers ───
function fmtHHMM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function shortDate(iso: string): string {
  // "2026-04-29" → "Apr 29"
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function dayName(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function cellStyle(cell: DateCell): React.CSSProperties {
  if (cell.kind === "weekend") {
    return { background: "#e8eaf6", color: "#5c6bc0", fontStyle: "italic" };
  }
  if (cell.kind === "no-data") {
    return { background: "#e0e0e0", color: "#666" };
  }
  // "data" — color by hours
  const hours = cell.activeSeconds / 3600;
  if (hours >= 7) return { background: "#c8e6c9", color: "#1b5e20", fontWeight: 600 };
  if (hours >= 4) return { background: "#ffcc80", color: "#e65100", fontWeight: 600 };
  return { background: "#ffcdd2", color: "#c62828", fontWeight: 600 };
}

function tbBadgeColor(pct: number): string {
  if (pct < 30) return "#ef5350";
  if (pct < 50) return "#ff9800";
  return "#4caf50";
}

// ─── Page ───
export default function TeamSnapshotPage() {
  const { accessToken, isManager } = useAuth();
  const [data, setData] = useState<SnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(14);

  const range = useMemo(() => {
    // 'to' = yesterday, 'from' = N days before that
    const to = dateNDaysAgo(1);
    const from = dateNDaysAgo(days);
    return { from, to };
  }, [days]);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    apiFetch<SnapshotResponse>(
      `/api/team-snapshot?from=${range.from}&to=${range.to}`,
      { token: accessToken }
    )
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, range.from, range.to]);

  if (!isManager) {
    return (
      <DashboardShell>
        <div className="page-header">
          <div className="page-title">Team Snapshot</div>
        </div>
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          This page is for managers and admins.
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">Team Snapshot</div>
          <div className="page-subtitle">Daily hours across the team — last {days} days, today excluded</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 14, 30].map((n) => (
            <button
              key={n}
              onClick={() => setDays(n)}
              className={`btn ${days === n ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading team snapshot…</div>
      ) : !data || data.groups.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          No team data to show. Make sure your direct reports have their <strong>team</strong> field set to your name on the Users page.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
              <thead>
                <tr style={{ background: "var(--bg-secondary)" }}>
                  <th style={thStyle}>Manager / Employee</th>
                  <th style={{ ...thStyle, textAlign: "center", whiteSpace: "nowrap" }}>ATD</th>
                  {data.dates.map((d) => (
                    <th key={d} style={{ ...thStyle, textAlign: "center", whiteSpace: "nowrap", minWidth: 76 }}>
                      <div style={{ fontWeight: 600 }}>{shortDate(d)}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>{dayName(d)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.groups.map((group) => (
                  <ManagerBlock key={group.managerName} group={group} dates={data.dates} />
                ))}
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
  position: "sticky" as const,
  top: 0,
  background: "var(--bg-secondary)",
  zIndex: 1,
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

function ManagerBlock({ group, dates }: { group: SnapshotGroup; dates: string[] }) {
  return (
    <>
      {/* Manager header row */}
      <tr style={{ background: "rgba(99, 102, 241, 0.08)" }}>
        <td style={{ ...tdStyle, fontWeight: 700 }}>
          👤 {group.managerName} ({group.employees.length})
          <span
            title={`Team logged ${(Object.values(group.perDateTeamAvgSeconds).reduce((a, c) => a + c, 0) * group.employees.length / 3600).toFixed(0)}h vs 8h × ${group.employees.length} × ${dates.filter((d) => { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); return wd !== 0 && wd !== 6; }).length} working days expected`}
            style={{
              marginLeft: 10,
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              color: "#fff",
              background: tbBadgeColor(group.teamBandwidthPct),
            }}
          >
            TB: {group.teamBandwidthPct.toFixed(1)}%
          </span>
        </td>
        <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700 }}>
          {fmtHHMM(group.headerAtdSeconds)}
        </td>
        {dates.map((d) => {
          const seconds = group.perDateTeamAvgSeconds[d] || 0;
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
          const isWeekend = wd === 0 || wd === 6;
          const cell: DateCell = isWeekend
            ? { activeSeconds: 0, kind: "weekend" }
            : seconds > 0
              ? { activeSeconds: seconds, kind: "data" }
              : { activeSeconds: 0, kind: "no-data" };
          return (
            <td key={d} style={{ ...tdStyle, ...cellStyle(cell), textAlign: "center" }}>
              {cell.kind === "weekend" ? (wd === 0 ? "Sun" : "Sat") : fmtHHMM(seconds)}
            </td>
          );
        })}
      </tr>
      {/* Employee rows */}
      {group.employees.map((emp) => (
        <tr key={emp.userId}>
          <td style={tdStyle}>
            <div style={{ paddingLeft: 18 }}>
              <span style={{ fontWeight: 500 }}>{emp.fullName || emp.email}</span>
              {emp.isAllManual && (
                <span
                  title="All sessions in this range were entered manually by an admin"
                  style={{
                    marginLeft: 8,
                    padding: "1px 6px",
                    borderRadius: 3,
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#e65100",
                    background: "#ffe0b2",
                  }}
                >
                  MANUAL
                </span>
              )}
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{emp.email}</div>
            </div>
          </td>
          <td style={{ ...tdStyle, textAlign: "center", fontWeight: 600 }}>
            {fmtHHMM(emp.atdSeconds)}
          </td>
          {dates.map((d) => {
            const cell = emp.perDate[d] || { activeSeconds: 0, kind: "no-data" as const };
            const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
            return (
              <td key={d} style={{ ...tdStyle, ...cellStyle(cell), textAlign: "center" }}>
                {cell.kind === "weekend"
                  ? (wd === 0 ? "Sun" : "Sat")
                  : cell.kind === "no-data"
                    ? "—"
                    : fmtHHMM(cell.activeSeconds)}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
