"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDuration } from "@/lib/format";

interface MySession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  activeSeconds: number;
  idleSeconds: number;
  externalProjectId: number | null;
  externalTaskId: number | null;
}

// Group sessions by project
interface ProjectSummary {
  projectName: string;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  sessionCount: number;
  lastActive: string;
}

export default function MyProjectsPage() {
  const { accessToken } = useAuth();
  const [sessions, setSessions] = useState<MySession[]>([]);
  const [loading, setLoading] = useState(true);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  useEffect(() => {
    if (!accessToken) return;
    apiFetch<{ data: MySession[] }>(`/api/activity/me/sessions?from=${thirtyDaysAgo.toISOString()}&limit=100`, { token: accessToken })
      .then((res) => setSessions(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  // Group by project
  const totalActive = sessions.reduce((s, sess) => s + (sess.activeSeconds || 0), 0);

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">My Projects</div>
          <div className="page-subtitle">Your activity across projects — last 30 days</div>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading project data...</div>
      ) : (
        <>
          <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--bg-card)", borderRadius: 8 }}>
            Total active time: <strong style={{ color: "var(--success)" }}>{formatDuration(totalActive)}</strong>
            {" · "}{sessions.length} sessions
          </div>

          <div className="card">
            <div className="card-header">Recent Sessions</div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Started</th><th>Duration</th><th>Active</th><th>Idle</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const duration = (s.activeSeconds || 0) + (s.idleSeconds || 0);
                    return (
                      <tr key={s.id}>
                        <td>{new Date(s.startedAt).toLocaleString()}</td>
                        <td>{formatDuration(duration)}</td>
                        <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(s.activeSeconds || 0)}</td>
                        <td style={{ color: "var(--warning)" }}>{formatDuration(s.idleSeconds || 0)}</td>
                        <td>
                          {s.endedAt ? (
                            <span style={{ color: "var(--text-muted)" }}>Ended</span>
                          ) : (
                            <span style={{ color: "var(--success)" }}>Active</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {sessions.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>No sessions recorded yet</td></tr>
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
