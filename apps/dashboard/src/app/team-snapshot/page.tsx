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
  // True when this row is the manager-themselves shown inside their own
  // team's bucket. Frontend tags the name with "(Manager)".
  isOwnManager?: boolean;
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
    // "Not Logged" is longer than the H:MM format; shrink the type so the
    // column doesn't widen when one user didn't track on a given day.
    return { background: "#e0e0e0", color: "#666", fontSize: 10, fontStyle: "italic" as const };
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
  // Last day of the month (default upper bound for past months)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let to = `${y}-${m.toString().padStart(2, "0")}-${last.toString().padStart(2, "0")}`;
  // If the chosen month is the CURRENT month, cap the upper bound at
  // yesterday — picking "May 2026" mid-May should not render columns for
  // dates that haven't happened yet. Backend re-clamps too as a safety
  // net (see the date-column loop in activity.routes.ts).
  const yesterday = dateNDaysAgo(1);
  if (to > yesterday) to = yesterday;
  return { from, to };
}

export default function TeamSnapshotPage() {
  const { accessToken, isManager, isAdmin } = useAuth();
  const [data, setData] = useState<SnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Default range = current month-to-date (Cattr parity). Was rolling 14d;
  // month-to-date is what most managers ask for at the start of each month.
  // Users can still switch to a rolling N-day view via the toggle.
  const [rangeMode, setRangeMode] = useState<RangeMode>("month");
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

  // CSV export of the visible grid — one row per employee, one column per
  // date in the response, plus Manager / Name / Email / ATD as fixed columns.
  // Cell values mirror what we render: HH:MM for data, label text for
  // weekend/holiday/leave/no-data. Cattr only ships CSV for the Bandwidth
  // modal; adding it here is a small win for HR doing manual exports.
  function downloadCsv() {
    if (!data) return;
    const dateCols = data.dates;
    const csvEscape = (s: string): string => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const header = ["Manager", "Name", "Email", "ATD", ...dateCols.map((d) => {
      const date = new Date(`${d}T00:00:00Z`);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    })];
    const lines = [header.map(csvEscape).join(",")];
    for (const group of data.groups) {
      for (const emp of group.employees) {
        const cells = dateCols.map((d) => {
          const cell = emp.perDate[d];
          if (!cell) return "";
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
          if (cell.kind === "weekend") return wd === 0 ? "Sun" : "Sat";
          if (cell.kind === "holiday") return cell.activeSeconds > 0 ? fmtHHMM(cell.activeSeconds) : (cell.label ?? "Holiday");
          if (cell.kind === "leave") return cell.activeSeconds > 0 ? fmtHHMM(cell.activeSeconds) : (cell.label ?? "Leave");
          if (cell.kind === "no-data") return "Not Logged";
          return fmtHHMM(cell.activeSeconds);
        });
        const nameLabel = emp.isOwnManager ? `${emp.fullName} (Manager)` : emp.fullName;
        lines.push([
          csvEscape(group.managerName),
          csvEscape(nameLabel || emp.email),
          csvEscape(emp.email),
          fmtHHMM(emp.atdSeconds),
          ...cells.map(csvEscape),
        ].join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `team-snapshot-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
        <div style={{ display: "flex", gap: 8 }}>
          {/* Download CSV is available to everyone who can see the grid —
              even a developer's single-row view can be useful as a personal
              record. Disabled until the data loads. */}
          <button
            className="btn btn-secondary"
            onClick={downloadCsv}
            disabled={!data || data.groups.length === 0}
            style={{ padding: "8px 16px", fontSize: 13 }}
            title="Export the current grid as CSV"
          >
            📥 Download CSV
          </button>
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
          {/* Clamp the grid to 70vh and let it own its own scrolling — both
              axes. Two wins:
                - `position: sticky; top: 0` on <th> actually sticks now,
                  because this wrapper is the nearest scrollable ancestor.
                  Date header stays visible while the user scrolls down rows.
                - The horizontal scrollbar lives at the bottom of THIS
                  wrapper (which is on-screen), not at the bottom of a 100-row
                  table that's halfway off the page. */}
          <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "70vh" }}>
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
                  <ManagerBlock
                    key={group.managerName}
                    group={group}
                    dates={data.dates}
                    showHeader={isManager}
                  />
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
  // z-index has to clear the manager-group header rows (which use an indigo
  // tint background and would otherwise paint over the sticky th when they
  // scroll under it).
  zIndex: 2,
  // Soft shadow draws a visual edge between the pinned header and the rows
  // sliding underneath — without it the header looks weirdly attached to
  // whatever row is at the top of the viewport.
  boxShadow: "0 1px 0 var(--border)",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

function ManagerBlock({ group, dates, showHeader }: { group: SnapshotGroup; dates: string[]; showHeader: boolean }) {
  return (
    <>
      {/* Manager header row — only rendered when the viewer is a manager.
          Employees viewing /team-snapshot get their own single row directly
          (no parent group header), so they don't see their manager's name
          or the team-bandwidth aggregate (which would just be themselves
          and look bizarre at low utilization). */}
      {showHeader && (
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
          {/* Underutilized — when the team's bandwidth is below 70%, flag the
              manager loudly. Matches Cattr's "UNDERUTILIZED" badge. The TB
              badge above already changes color, but a separate text badge is
              easier to scan when there are many teams. */}
          {group.teamBandwidthPct < 70 && (
            <span
              title="Team bandwidth below 70% — investigate why this team is under-occupied"
              style={{
                marginLeft: 6,
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                color: "#fff",
                background: "#ef5350",
                letterSpacing: 0.3,
              }}
            >
              UNDERUTILIZED
            </span>
          )}
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
      )}
      {/* Employee rows */}
      {group.employees.map((emp) => (
        <tr key={emp.userId}>
          <td style={tdStyle}>
            {/* Indent under the manager-header bar when one is shown;
                no indent when the viewer is an employee (no header above). */}
            <div style={{ paddingLeft: showHeader ? 18 : 0 }}>
              <span style={{ fontWeight: 500 }}>{emp.fullName || emp.email}</span>
              {emp.isOwnManager && (
                <span
                  title="This person is the manager of this team"
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#6366f1",
                    letterSpacing: 0.3,
                  }}
                >
                  (Manager)
                </span>
              )}
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
                        ? "Not Logged"
                        : fmtHHMM(cell.activeSeconds)}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
