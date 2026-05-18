"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { DateRangeFilter, dateRangePresets, dateRangeToISO, type DateRange } from "@/components/DateRangeFilter";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDuration, formatNumber, timeAgo } from "@/lib/format";

interface TeamMember {
  userId: string;
  email: string;
  fullName: string;
  team: string | null;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalFileSaves: number;
  sessionCount: number;
  lastActive: string;
}

export default function TeamOverviewPage() {
  const { accessToken, user, isAdmin, isManager, loading: authLoading } = useAuth();
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>(() => dateRangePresets.last30Days());

  // Send non-admins to a page that's actually for them. Auth check has to be done
  // first so we don't redirect mid-session-restore.
  useEffect(() => {
    if (authLoading || !user) return;
    if (!isAdmin) {
      router.replace(isManager ? "/my-team" : "/me");
    }
  }, [authLoading, user, isAdmin, isManager, router]);

  useEffect(() => {
    if (!accessToken || !isAdmin) return;
    setLoading(true);

    const iso = dateRangeToISO(dateRange);
    const params = new URLSearchParams({ limit: "100" });
    if (iso.from) params.set("from", iso.from);
    if (iso.to) params.set("to", iso.to);

    apiFetch<{ data: TeamMember[] }>(
      `/api/admin/activity/overview?${params}`,
      { token: accessToken }
    )
      .then((res) => setMembers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, isAdmin, dateRange.from, dateRange.to]);

  const totalActive = members.reduce((sum, m) => sum + m.totalActiveSeconds, 0);
  const totalIdle = members.reduce((sum, m) => sum + m.totalIdleSeconds, 0);
  const totalSessions = members.reduce((sum, m) => sum + m.sessionCount, 0);
  const activeDevelopers = members.filter(
    (m) => Date.now() - new Date(m.lastActive).getTime() < 24 * 60 * 60 * 1000
  ).length;
  const activeNow = members.filter(
    (m) => Date.now() - new Date(m.lastActive).getTime() < 10 * 60 * 1000
  ).length;

  const rangeLabel = (() => {
    if (!dateRange.from && !dateRange.to) return "(all time)";
    if (dateRange.from === dateRange.to) return "(today)";
    if (dateRange.from && dateRange.to) {
      const days = Math.round((new Date(dateRange.to).getTime() - new Date(dateRange.from).getTime()) / 86400000) + 1;
      return `(${days}d)`;
    }
    return "";
  })();

  // Non-admins see a brief redirect message instead of the empty admin layout
  if (!authLoading && user && !isAdmin) {
    return (
      <DashboardShell>
        <div className="loading">Redirecting…</div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-title">Team Overview</div>
          <div className="page-subtitle">{user?.fullName ? `Welcome back, ${user.fullName.split(" ")[0]}.` : ""} {activeNow > 0 ? `${activeNow} ${activeNow === 1 ? "person is" : "people are"} working right now.` : "No one is actively tracking right now."}</div>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* Snapshot of right now */}
      <div className="stats-grid">
        <StatCard value={String(activeNow)} label="Active in last 10 min" color="green" />
        <StatCard value={String(activeDevelopers)} label="Active today" color="blue" />
        <StatCard value={String(members.length)} label="Tracked users" color="purple" />
        <StatCard value={String(totalSessions)} label="Sessions this month" color="yellow" />
      </div>

      {/* Range totals */}
      <div className="stats-grid" style={{ marginTop: 8 }}>
        <StatCard value={formatDuration(totalActive)} label={`Active time ${rangeLabel}`} color="blue" />
        <StatCard value={formatDuration(totalIdle)} label={`Idle time ${rangeLabel}`} color="yellow" />
        <StatCard value={String(activeDevelopers)} label="Active devs (24h)" color="green" />
        <StatCard value={String(members.length)} label="Total developers" color="purple" />
      </div>

      {/* Flagged-row counters — quick scan before the manager dives into the table */}
      {!loading && members.length > 0 && (() => {
        const fishyCount = members.filter((m) => m.totalActiveSeconds >= 4 * 3600 && m.totalIdleSeconds === 0).length;
        const staleCount = members.filter((m) => {
          const d = Math.floor((Date.now() - new Date(m.lastActive).getTime()) / 86_400_000);
          return d >= 7;
        }).length;
        if (fishyCount === 0 && staleCount === 0) return null;
        return (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8, fontSize: 13 }}>
            {fishyCount > 0 && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 12px", color: "#f87171" }}>
                <strong>{fishyCount}</strong> developer{fishyCount === 1 ? "" : "s"} with 4h+ active but 0 idle reported — check client setup.
              </div>
            )}
            {staleCount > 0 && (
              <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 6, padding: "8px 12px", color: "#facc15" }}>
                <strong>{staleCount}</strong> developer{staleCount === 1 ? "" : "s"} inactive for 7+ days — verify employment status before payroll cycle.
              </div>
            )}
          </div>
        );
      })()}

      <div className="card">
        <div className="card-header">Developer Activity</div>
        {loading ? (
          <div className="loading">Loading team data...</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Developer</th>
                  <th>Team</th>
                  <th>Active Time</th>
                  <th>Idle Time</th>
                  <th>File Saves</th>
                  <th>Sessions</th>
                  <th>Last Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  // Fishy pattern: lots of active time but ZERO idle reported.
                  // A real day involves at least short away-from-desk moments
                  // (>10 min triggers OS-idle). 4h+ active with 0 idle means
                  // either (a) anti-cheat tooling is jiggling the mouse,
                  // (b) the client hasn't updated to a build that reports idle,
                  // or (c) OS-idle detection is broken on their machine.
                  // Either way, a manager wants to see this row flagged.
                  const isFishyZeroIdle = m.totalActiveSeconds >= 4 * 3600 && m.totalIdleSeconds === 0;
                  // Stale: no heartbeat for a long time. Could be leaving the
                  // company, broken extension install, or extended leave —
                  // payroll cycle needs to know either way.
                  const msSinceActive = Date.now() - new Date(m.lastActive).getTime();
                  const daysSinceActive = Math.floor(msSinceActive / 86_400_000);
                  const isVeryStale = daysSinceActive >= 30;
                  const isStale = daysSinceActive >= 7 && !isVeryStale;

                  return (
                  <tr key={m.userId}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="avatar">
                          {m.fullName
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {m.fullName}
                            {isFishyZeroIdle && (
                              <span title="Active for 4h+ but reported 0 idle time. Worth checking the client install / anti-cheat tooling." style={{ fontSize: 10, fontWeight: 600, background: "rgba(239,68,68,0.15)", color: "#f87171", padding: "1px 6px", borderRadius: 3, letterSpacing: 0.3 }}>
                                ⚠ 0 IDLE
                              </span>
                            )}
                            {isVeryStale && (
                              <span title={`No activity for ${daysSinceActive} days. Verify employment status.`} style={{ fontSize: 10, fontWeight: 600, background: "rgba(239,68,68,0.15)", color: "#f87171", padding: "1px 6px", borderRadius: 3, letterSpacing: 0.3 }}>
                                ⚠ INACTIVE {daysSinceActive}d
                              </span>
                            )}
                            {isStale && (
                              <span title={`No activity for ${daysSinceActive} days. Possibly on leave or extension broken.`} style={{ fontSize: 10, fontWeight: 600, background: "rgba(251,191,36,0.15)", color: "#facc15", padding: "1px 6px", borderRadius: 3, letterSpacing: 0.3 }}>
                                STALE {daysSinceActive}d
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>{m.team || "—"}</td>
                    <td>{formatDuration(m.totalActiveSeconds)}</td>
                    <td style={{ color: "var(--warning)" }}>{formatDuration(m.totalIdleSeconds)}</td>
                    <td>{formatNumber(m.totalFileSaves)}</td>
                    <td>{m.sessionCount}</td>
                    <td>
                      <span className={`badge ${Date.now() - new Date(m.lastActive).getTime() < 600000 ? "badge-active" : Date.now() - new Date(m.lastActive).getTime() < 3600000 ? "badge-idle" : "badge-offline"}`}>
                        {timeAgo(m.lastActive)}
                      </span>
                    </td>
                    <td>
                      <Link href={`/developer?id=${m.userId}`} className="btn btn-secondary">
                        View
                      </Link>
                    </td>
                  </tr>
                );})}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                      No developer activity recorded yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
