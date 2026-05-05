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
