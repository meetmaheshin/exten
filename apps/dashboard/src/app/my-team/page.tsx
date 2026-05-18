"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/DashboardShell";
import { DateRangeFilter, dateRangePresets, dateRangeToISO, type DateRange } from "@/components/DateRangeFilter";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDuration } from "@/lib/format";

interface TeamMember {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  team: string | null;
  isActive: boolean;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  sessionCount: number;
  lastActive: string | null;
}

export default function MyTeamPage() {
  const { accessToken, user, isManager } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>(() => dateRangePresets.last30Days());

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const iso = dateRangeToISO(dateRange);
    const params = new URLSearchParams();
    if (iso.from) params.set("from", iso.from);
    if (iso.to) params.set("to", iso.to);
    apiFetch<{ data: TeamMember[] }>(`/api/my-team?${params}`, { token: accessToken })
      .then((res) => setMembers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, dateRange.from, dateRange.to]);

  if (!isManager) {
    return (
      <DashboardShell>
        <div className="page-header">
          <div className="page-title">My Team</div>
        </div>
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          You need Manager or Admin role to view team data.
        </div>
      </DashboardShell>
    );
  }

  const totalActive = members.reduce((s, m) => s + m.totalActiveSeconds, 0);
  const totalIdle = members.reduce((s, m) => s + m.totalIdleSeconds, 0);

  return (
    <DashboardShell>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-title">My Team</div>
          <div className="page-subtitle">{members.length} team members</div>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {loading ? (
        <div className="loading">Loading team data...</div>
      ) : (
        <>
          <div className="stats-grid">
            <StatCard value={String(members.length)} label="Team Members" color="blue" />
            <StatCard value={formatDuration(totalActive)} label="Total Active Time" color="green" />
            <StatCard value={formatDuration(totalIdle)} label="Total Idle Time" color="yellow" />
            <StatCard value={String(members.filter((m) => {
              if (!m.lastActive || !dateRange.from) return Boolean(m.lastActive);
              return new Date(m.lastActive) >= new Date(dateRange.from);
            }).length)} label="Active in range" color="purple" />
          </div>

          {/* Flagged-row counters — quick scan for the manager before
              they dive into the table. Same logic as the admin team-overview;
              scoped to this manager's team because the data is. */}
          {(() => {
            const fishyCount = members.filter((m) => m.totalActiveSeconds >= 4 * 3600 && m.totalIdleSeconds === 0).length;
            const staleCount = members.filter((m) => {
              if (!m.lastActive) return false;
              const d = Math.floor((Date.now() - new Date(m.lastActive).getTime()) / 86_400_000);
              return d >= 7;
            }).length;
            if (fishyCount === 0 && staleCount === 0) return null;
            return (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8, fontSize: 13 }}>
                {fishyCount > 0 && (
                  <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 12px", color: "#f87171" }}>
                    <strong>{fishyCount}</strong> team member{fishyCount === 1 ? "" : "s"} with 4h+ active but 0 idle reported — check their client setup.
                  </div>
                )}
                {staleCount > 0 && (
                  <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 6, padding: "8px 12px", color: "#facc15" }}>
                    <strong>{staleCount}</strong> team member{staleCount === 1 ? "" : "s"} inactive for 7+ days — verify before payroll.
                  </div>
                )}
              </div>
            );
          })()}

          <div className="card">
            <div className="card-header">Team Members</div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Active Time</th>
                    <th>Idle Time</th>
                    <th>Sessions</th>
                    <th>Last Active</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const isFishyZeroIdle = m.totalActiveSeconds >= 4 * 3600 && m.totalIdleSeconds === 0;
                    const msSinceActive = m.lastActive ? Date.now() - new Date(m.lastActive).getTime() : Infinity;
                    const daysSinceActive = m.lastActive ? Math.floor(msSinceActive / 86_400_000) : null;
                    const isVeryStale = daysSinceActive !== null && daysSinceActive >= 30;
                    const isStale = daysSinceActive !== null && daysSinceActive >= 7 && !isVeryStale;
                    return (
                    <tr key={m.userId}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: "50%", background: "var(--primary)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 600, color: "#fff",
                          }}>
                            {m.fullName[0]?.toUpperCase() || "?"}
                          </div>
                          <div>
                            <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              {m.fullName}
                              {isFishyZeroIdle && (
                                <span title="Active for 4h+ but reported 0 idle. Likely client issue — check their setup." style={{ fontSize: 10, fontWeight: 600, background: "rgba(239,68,68,0.15)", color: "#f87171", padding: "1px 6px", borderRadius: 3, letterSpacing: 0.3 }}>
                                  ⚠ 0 IDLE
                                </span>
                              )}
                              {isVeryStale && daysSinceActive !== null && (
                                <span title={`No activity for ${daysSinceActive} days. Verify employment status.`} style={{ fontSize: 10, fontWeight: 600, background: "rgba(239,68,68,0.15)", color: "#f87171", padding: "1px 6px", borderRadius: 3, letterSpacing: 0.3 }}>
                                  ⚠ INACTIVE {daysSinceActive}d
                                </span>
                              )}
                              {isStale && daysSinceActive !== null && (
                                <span title={`No activity for ${daysSinceActive} days. Possibly on leave or extension broken.`} style={{ fontSize: 10, fontWeight: 600, background: "rgba(251,191,36,0.15)", color: "#facc15", padding: "1px 6px", borderRadius: 3, letterSpacing: 0.3 }}>
                                  STALE {daysSinceActive}d
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.email}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="badge">{m.role}</span></td>
                      <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(m.totalActiveSeconds)}</td>
                      <td style={{ color: "var(--warning)" }}>{formatDuration(m.totalIdleSeconds)}</td>
                      <td>{m.sessionCount}</td>
                      <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                        {m.lastActive ? new Date(m.lastActive).toLocaleDateString() : "Never"}
                      </td>
                      <td>
                        <Link href={`/developer?id=${m.userId}`} className="btn btn-secondary" style={{ padding: "4px 12px", fontSize: 12 }}>
                          Details
                        </Link>
                      </td>
                    </tr>
                  );})}
                  {members.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>No team members found. Your team is based on your name matching the "team" field in user profiles.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </DashboardShell>
  );
}

function StatCard({ value, label, color }: { value: string; label: string; color: string }) {
  const colors: Record<string, string> = { blue: "var(--accent-blue)", green: "var(--success)", yellow: "var(--warning)", purple: "var(--accent-purple)" };
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color: colors[color] || colors.blue }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
