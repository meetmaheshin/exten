"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDuration, formatNumber } from "@/lib/format";

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

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  useEffect(() => {
    if (!accessToken) return;
    apiFetch<{ data: TeamMember[] }>(`/api/my-team?from=${thirtyDaysAgo.toISOString()}`, { token: accessToken })
      .then((res) => setMembers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

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
      <div className="page-header">
        <div>
          <div className="page-title">My Team</div>
          <div className="page-subtitle">{members.length} team members — last 30 days</div>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading team data...</div>
      ) : (
        <>
          <div className="stats-grid">
            <StatCard value={String(members.length)} label="Team Members" color="blue" />
            <StatCard value={formatDuration(totalActive)} label="Total Active Time" color="green" />
            <StatCard value={formatDuration(totalIdle)} label="Total Idle Time" color="yellow" />
            <StatCard value={String(members.filter((m) => m.lastActive && new Date(m.lastActive) > thirtyDaysAgo).length)} label="Active This Month" color="purple" />
          </div>

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
                  {members.map((m) => (
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
                            <div style={{ fontWeight: 500 }}>{m.fullName}</div>
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
                  ))}
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
