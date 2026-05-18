"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { TeamSnapshotTabs } from "@/components/TeamSnapshotTabs";
import { SummaryReportModal } from "@/components/SummaryReportModal";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

// ─── Types matching the /api/team-snapshot response ───
interface DateCell {
  activeSeconds: number;
  kind: "data" | "no-data" | "weekend" | "holiday" | "leave";
  label?: string;
}
interface SnapshotEmployee {
  userId: string;
  fullName: string;
  email: string;
  atdSeconds: number;
  isAllManual: boolean;
  employmentStatus?: string;
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
  if (cell.kind === "holiday") {
    return { background: "#e3f2fd", color: "#1565c0", fontStyle: "italic" };
  }
  if (cell.kind === "leave") {
    return { background: "#fff3e0", color: "#bf360c", fontStyle: "italic" };
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
type RangeMode = "rolling" | "month";
type GroupMode = "manager" | "flat";

function monthOptions(): Array<{ value: string; label: string }> {
  // Last 12 months including current. Value is "YYYY-MM".
  const out: Array<{ value: string; label: string }> = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const y = d.getFullYear();
    const m = d.getMonth();
    const value = `${y}-${(m + 1).toString().padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    out.push({ value, label });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function rangeForMonth(yyyymm: string): { from: string; to: string } {
  const [y, m] = yyyymm.split("-").map(Number);
  const from = `${y}-${m.toString().padStart(2, "0")}-01`;
  // Last day of month
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${m.toString().padStart(2, "0")}-${last.toString().padStart(2, "0")}`;
  return { from, to };
}

export default function TeamSnapshotPage() {
  const { accessToken, isManager, isAdmin } = useAuth();
  const [data, setData] = useState<SnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeMode, setRangeMode] = useState<RangeMode>("rolling");
  const [days, setDays] = useState(14);
  // Summary modal — opens from the page-header button. Manager-gated; devs
  // don't need an aggregate report about themselves.
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [month, setMonth] = useState<string>(() => monthOptions()[0].value);
  const [managerFilter, setManagerFilter] = useState<string>(""); // "" = all managers
  const [groupMode, setGroupMode] = useState<GroupMode>("manager");

  const range = useMemo(() => {
    if (rangeMode === "month") return rangeForMonth(month);
    return { from: dateNDaysAgo(days), to: dateNDaysAgo(1) };
  }, [rangeMode, days, month]);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    if (managerFilter) qs.set("managerName", managerFilter);
    apiFetch<SnapshotResponse>(`/api/team-snapshot?${qs.toString()}`, { token: accessToken })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, range.from, range.to, managerFilter]);

  // For the manager filter: collect unique manager names from the response so
  // the dropdown only offers groups that actually exist.
  const knownManagers = useMemo(() => {
    if (!data) return [] as string[];
    return data.groups.map((g) => g.managerName);
  }, [data]);

  // Flatten when groupMode=flat: collapse all employees into one synthetic group
  const displayGroups = useMemo<SnapshotGroup[]>(() => {
    if (!data) return [];
    if (groupMode === "manager") return data.groups;
    const allEmployees = data.groups.flatMap((g) => g.employees);
    if (allEmployees.length === 0) return [];
    const perDateTeamAvgSeconds: Record<string, number> = {};
    for (const d of data.dates) {
      const sum = allEmployees.reduce((acc, e) => acc + (e.perDate[d]?.activeSeconds || 0), 0);
      perDateTeamAvgSeconds[d] = Math.round(sum / allEmployees.length);
    }
    return [{
      managerId: null,
      managerName: "Everyone",
      headerAtdSeconds: Math.round(
        allEmployees.reduce((a, e) => a + e.atdSeconds, 0) / allEmployees.length
      ),
      teamBandwidthPct:
        data.groups.reduce((a, g) => a + g.teamBandwidthPct * g.employees.length, 0) /
        Math.max(1, allEmployees.length),
      perDateTeamAvgSeconds,
      employees: allEmployees,
    }];
  }, [data, groupMode]);

  // Page is open to everyone; backend filters the rows by role
  // (developer → own only, manager → team, admin → all). The Summary
  // Report button below is still manager-gated since aggregate reports
  // about one person don't add value.

  const subtitle =
    rangeMode === "month"
      ? `${monthOptions().find((o) => o.value === month)?.label ?? month} — today excluded`
      : `Last ${days} days — today excluded`;

  return (
    <DashboardShell>
      <TeamSnapshotTabs />

      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-title">Team Snapshot</div>
          <div className="page-subtitle">{subtitle}</div>
        </div>
        {isManager && (
          <button
            className="btn btn-primary"
            onClick={() => setSummaryOpen(true)}
            style={{ padding: "8px 16px", fontSize: 13 }}
          >
            📊 Summary Report
          </button>
        )}
      </div>

      {/* Filter row */}
      <div className="card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {/* Range mode */}
        <label style={controlLabelStyle}>
          Range
          <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value as RangeMode)} style={selectStyle}>
            <option value="rolling">Last N days</option>
            <option value="month">Specific month</option>
          </select>
        </label>

        {rangeMode === "rolling" ? (
          <div style={{ display: "flex", gap: 4 }}>
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
        ) : (
          <label style={controlLabelStyle}>
            Month
            <select value={month} onChange={(e) => setMonth(e.target.value)} style={selectStyle}>
              {monthOptions().map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        )}

        {/* Group by */}
        <label style={controlLabelStyle}>
          Group by
          <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)} style={selectStyle}>
            <option value="manager">Manager</option>
            <option value="flat">Flat (no grouping)</option>
          </select>
        </label>

        {/* Filter by manager — admin only */}
        {isAdmin && (
          <label style={controlLabelStyle}>
            Filter by manager
            <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} style={selectStyle}>
              <option value="">All managers</option>
              {knownManagers.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <div className="loading">Loading team snapshot…</div>
      ) : !data || displayGroups.length === 0 ? (
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
                {displayGroups.map((group) => (
                  <ManagerBlock key={group.managerName} group={group} dates={data.dates} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SummaryReportModal open={summaryOpen} onClose={() => setSummaryOpen(false)} />
    </DashboardShell>
  );
}

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

const selectStyle: React.CSSProperties = {
  padding: "6px 10px",
  background: "var(--bg-card)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 13,
  textTransform: "none",
  fontWeight: 400,
  letterSpacing: 0,
};

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
            <td key={d} style={{ ...tdStyle, ...cellStyle(cell), textAlign: "center" }} title={cell.label}>
              {cell.kind === "weekend"
                ? (wd === 0 ? "Sun" : "Sat")
                : cell.kind === "holiday"
                  ? "Holiday"
                  : fmtHHMM(seconds)}
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
              {emp.employmentStatus && emp.employmentStatus !== "active" && (
                <span
                  title={`Employment status: ${emp.employmentStatus}`}
                  style={{
                    marginLeft: 8,
                    padding: "1px 6px",
                    borderRadius: 3,
                    fontSize: 9,
                    fontWeight: 700,
                    color: emp.employmentStatus === "resigned" ? "#c62828"
                      : emp.employmentStatus === "notice" ? "#ef6c00"
                      : "#6a1b9a",
                    background: emp.employmentStatus === "resigned" ? "#ffcdd2"
                      : emp.employmentStatus === "notice" ? "#ffe0b2"
                      : "#e1bee7",
                    textTransform: "uppercase",
                  }}
                >
                  {emp.employmentStatus.replace("_", " ")}
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
              <td key={d} style={{ ...tdStyle, ...cellStyle(cell), textAlign: "center" }} title={cell.label}>
                {cell.kind === "weekend"
                  ? (wd === 0 ? "Sun" : "Sat")
                  : cell.kind === "holiday"
                    ? (cell.activeSeconds > 0 ? fmtHHMM(cell.activeSeconds) : "Holiday")
                    : cell.kind === "leave"
                      ? (cell.activeSeconds > 0 ? fmtHHMM(cell.activeSeconds) : (cell.label ?? "Leave"))
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
