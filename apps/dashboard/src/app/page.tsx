"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/DashboardShell";
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
  const { accessToken } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    apiFetch<{ data: TeamMember[] }>(
      `/api/admin/activity/overview?from=${thirtyDaysAgo.toISOString()}&limit=100`,
      { token: accessToken }
    )
      .then((res) => setMembers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  const totalActive = members.reduce((sum, m) => sum + m.totalActiveSeconds, 0);
  const totalIdle = members.reduce((sum, m) => sum + m.totalIdleSeconds, 0);
  const totalSessions = members.reduce((sum, m) => sum + m.sessionCount, 0);
  const activeDevelopers = members.filter(
    (m) => Date.now() - new Date(m.lastActive).getTime() < 24 * 60 * 60 * 1000
  ).length;

  return (
    <DashboardShell>
      <div className="page-header">
        <div className="page-title">Team Overview</div>
        <div className="page-subtitle">Activity summary for the last 30 days</div>
      </div>

      <div className="stats-grid">
        <StatCard value={String(members.length)} label="Total Developers" color="blue" />
        <StatCard value={String(activeDevelopers)} label="Active Today" color="green" />
        <StatCard value={formatDuration(totalActive)} label="Total Active Time" color="purple" />
        <StatCard value={formatDuration(totalIdle)} label="Total Idle Time" color="yellow" />
      </div>

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
                {members.map((m) => (
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
                          <div style={{ fontWeight: 500 }}>{m.fullName}</div>
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
                ))}
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
