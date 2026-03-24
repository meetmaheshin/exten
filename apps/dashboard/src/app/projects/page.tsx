"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch, API_BASE } from "@/lib/api";
import { formatDuration } from "@/lib/format";

interface ProjectActivity {
  project_id: number;
  project_name: string;
  stage_name: string | null;
  total_active_seconds: number;
  total_keystrokes: number;
  unique_developers: number;
  session_count: number;
}

interface TaskActivity {
  task_id: number;
  task_name: string;
  state: string | null;
  stage_name: string | null;
  total_active_seconds: number;
  unique_developers: number;
  session_count: number;
}

interface SyncStatus {
  projects: { totalProjects: number; lastSync: string | null; activeProjects: number };
  tasks: { totalTasks: number };
  userMappings: { mappedUsers: number };
}

interface LiveDev {
  user_id: string;
  full_name: string;
  email: string;
  project_id: number | null;
  project_name: string | null;
  task_id: number | null;
  task_name: string | null;
  active_seconds_today: number;
  session_started_at: string;
}

export default function ProjectsPage() {
  const { accessToken } = useAuth();
  const [projects, setProjects] = useState<ProjectActivity[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectActivity | null>(null);
  const [tasks, setTasks] = useState<TaskActivity[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [liveDevs, setLiveDevs] = useState<LiveDev[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"projects" | "live">("projects");

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromParam = thirtyDaysAgo.toISOString();

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    Promise.all([
      apiFetch<{ data: ProjectActivity[] }>(`/api/admin/projects/activity?from=${fromParam}&limit=100`, { token: accessToken }),
      apiFetch<SyncStatus>("/api/admin/sync/status", { token: accessToken }),
      apiFetch<{ data: LiveDev[] }>("/api/admin/projects/live", { token: accessToken }),
    ])
      .then(([pa, status, live]) => {
        setProjects(pa.data);
        setSyncStatus(status);
        setLiveDevs(live.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  useEffect(() => {
    if (!selectedProject || !accessToken) return;
    apiFetch<{ data: TaskActivity[] }>(
      `/api/admin/projects/${selectedProject.project_id}/tasks/activity`,
      { token: accessToken }
    )
      .then((res) => setTasks(res.data))
      .catch(console.error);
  }, [selectedProject, accessToken]);

  async function triggerSync() {
    if (!accessToken) return;
    setSyncing(true);
    try {
      const result = await apiFetch<{ projectsUpserted: number; tasksUpserted: number; durationMs: number; errors: string[] }>(
        "/api/admin/sync/projects",
        { token: accessToken, method: "POST", body: JSON.stringify({}) }
      );
      alert(
        `Sync complete!\n` +
        `Projects: ${result.projectsUpserted}\n` +
        `Tasks: ${result.tasksUpserted}\n` +
        `Time: ${(result.durationMs / 1000).toFixed(1)}s` +
        (result.errors.length > 0 ? `\nErrors:\n${result.errors.join("\n")}` : "")
      );
      // Refresh
      const [pa, status] = await Promise.all([
        apiFetch<{ data: ProjectActivity[] }>(`/api/admin/projects/activity?from=${fromParam}&limit=100`, { token: accessToken }),
        apiFetch<SyncStatus>("/api/admin/sync/status", { token: accessToken }),
      ]);
      setProjects(pa.data);
      setSyncStatus(status);
    } catch (e) {
      alert("Sync failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSyncing(false);
    }
  }

  const totalActiveSeconds = projects.reduce((s, p) => s + p.total_active_seconds, 0);

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">Projects</div>
          <div className="page-subtitle">
            Time tracked per platform project — last 30 days
            {syncStatus && (
              <span style={{ marginLeft: 12, color: "var(--text-muted)", fontSize: 11 }}>
                {syncStatus.projects.totalProjects} projects · {syncStatus.tasks.totalTasks} tasks · {syncStatus.userMappings.mappedUsers} mapped users
                {syncStatus.projects.lastSync && ` · Last sync: ${new Date(syncStatus.projects.lastSync).toLocaleString()}`}
              </span>
            )}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={triggerSync}
          disabled={syncing}
          style={{ minWidth: 120 }}
        >
          {syncing ? "Syncing…" : "↻ Sync Now"}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["projects", "live"] as const).map((t) => (
          <button
            key={t}
            className={`btn ${tab === t ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab(t)}
            style={{ minWidth: 100 }}
          >
            {t === "projects" ? "📊 Projects" : `🟢 Live (${liveDevs.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading project data…</div>
      ) : tab === "live" ? (
        /* ── LIVE VIEW ── */
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Developer</th>
                <th>Active Project</th>
                <th>Active Task</th>
                <th>Time Today</th>
                <th>Session Started</th>
              </tr>
            </thead>
            <tbody>
              {liveDevs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                    No active sessions right now
                  </td>
                </tr>
              ) : liveDevs.map((d) => (
                <tr key={d.user_id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{d.full_name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.email}</div>
                  </td>
                  <td>{d.project_name ?? <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.task_name ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
                  </td>
                  <td>{formatDuration(d.active_seconds_today)}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {new Date(d.session_started_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── PROJECTS VIEW ── */
        <div style={{ display: "grid", gridTemplateColumns: selectedProject ? "1fr 1fr" : "1fr", gap: 16 }}>
          {/* Projects list */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>All Projects</strong>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Total: {formatDuration(totalActiveSeconds)} active
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Active Time</th>
                  <th>Devs</th>
                  <th>Sessions</th>
                </tr>
              </thead>
              <tbody>
                {projects.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                      No project activity yet. Make sure developers have selected a project in the extension and the platform is synced.
                    </td>
                  </tr>
                ) : projects.map((p) => (
                  <tr
                    key={p.project_id}
                    onClick={() => setSelectedProject(selectedProject?.project_id === p.project_id ? null : p)}
                    style={{ cursor: "pointer", background: selectedProject?.project_id === p.project_id ? "var(--accent-subtle)" : undefined }}
                  >
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.project_name}</div>
                      {p.stage_name && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.stage_name}</div>}
                    </td>
                    <td>{formatDuration(p.total_active_seconds)}</td>
                    <td>{p.unique_developers}</td>
                    <td>{p.session_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Task breakdown for selected project */}
          {selectedProject && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{selectedProject.project_name}</strong>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Task breakdown</div>
                </div>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => setSelectedProject(null)}>✕</button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>State</th>
                    <th>Active Time</th>
                    <th>Devs</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                        No task-level tracking yet for this project
                      </td>
                    </tr>
                  ) : tasks.map((t) => (
                    <tr key={t.task_id}>
                      <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.task_name}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 11,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: stateColor(t.state).bg,
                          color: stateColor(t.state).text,
                        }}>
                          {t.stage_name ?? t.state ?? "—"}
                        </span>
                      </td>
                      <td>{formatDuration(t.total_active_seconds)}</td>
                      <td>{t.unique_developers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  );
}

function stateColor(state: string | null): { bg: string; text: string } {
  switch (state) {
    case "01_in_progress": return { bg: "#dbeafe", text: "#1d4ed8" };
    case "1_done":         return { bg: "#dcfce7", text: "#15803d" };
    case "03_cancelled":   return { bg: "#fee2e2", text: "#b91c1c" };
    default:               return { bg: "var(--surface)", text: "var(--text-muted)" };
  }
}
