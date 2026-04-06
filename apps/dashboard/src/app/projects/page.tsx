"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDuration, formatNumber } from "@/lib/format";

interface Project {
  id: number;
  name: string;
  stage_name: string | null;
  owner_name: string | null;
  business_unit: string | null;
  task_count: number;
  total_active_seconds: number;
  unique_developers: number;
  session_count: number;
}

interface ProjectDetail {
  project: { id: number; name: string; stageName: string | null; ownerName: string | null; businessUnit: string | null; taskCount: number };
  users: Array<{
    user_id: string; full_name: string; email: string;
    total_active_seconds: number; total_idle_seconds: number;
    total_keystrokes: number; total_file_saves: number;
    session_count: number; last_active: string;
  }>;
  daily: Array<{ date: string; total_active_seconds: number; unique_developers: number; session_count: number }>;
  tasks: Array<{ task_id: number; task_name: string; total_active_seconds: number; unique_developers: number; session_count: number }>;
}

interface LiveDev {
  user_id: string; full_name: string; email: string;
  project_id: number | null; project_name: string | null;
  task_id: number | null; task_name: string | null;
  active_seconds_today: number; session_started_at: string;
}

interface SyncStatus {
  projects: { totalProjects: number; lastSync: string | null; activeProjects: number };
  tasks: { totalTasks: number };
  userMappings: { mappedUsers: number };
}

export default function ProjectsPage() {
  const { accessToken } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [liveDevs, setLiveDevs] = useState<LiveDev[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"projects" | "live">("projects");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    Promise.all([
      apiFetch<{ data: Project[] }>("/api/admin/projects/list?limit=500", { token: accessToken }),
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

  async function loadProjectDetail(projectId: number) {
    if (!accessToken) return;
    setDetailLoading(true);
    try {
      const detail = await apiFetch<ProjectDetail>(
        `/api/admin/projects/${projectId}/detail`,
        { token: accessToken }
      );
      setSelectedProject(detail);
    } catch (e) { console.error(e); }
    finally { setDetailLoading(false); }
  }

  async function triggerSync() {
    if (!accessToken) return;
    setSyncing(true);
    try {
      await apiFetch("/api/admin/sync/projects", { token: accessToken, method: "POST", body: JSON.stringify({}) });
      window.location.reload();
    } catch (e) {
      alert("Sync failed: " + (e instanceof Error ? e.message : String(e)));
    } finally { setSyncing(false); }
  }

  const filtered = search
    ? projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.business_unit || "").toLowerCase().includes(search.toLowerCase()))
    : projects;

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">Projects</div>
          <div className="page-subtitle">
            {syncStatus && `${syncStatus.projects.totalProjects} projects · ${syncStatus.tasks.totalTasks} tasks · ${syncStatus.userMappings.mappedUsers} mapped users`}
            {syncStatus?.projects.lastSync && ` · Last sync: ${new Date(syncStatus.projects.lastSync).toLocaleString()}`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={triggerSync} disabled={syncing} style={{ minWidth: 120 }}>
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["projects", "live"] as const).map((t) => (
          <button key={t} className={`btn ${tab === t ? "btn-primary" : "btn-secondary"}`} onClick={() => { setTab(t); setSelectedProject(null); }} style={{ minWidth: 100 }}>
            {t === "projects" ? `All Projects (${filtered.length})` : `Live (${liveDevs.length})`}
          </button>
        ))}
      </div>

      {loading ? <div className="loading">Loading...</div> : tab === "live" ? (
        <div className="card">
          <div className="card-header">Active Sessions</div>
          <div className="table-container"><table><thead><tr>
            <th>Developer</th><th>Project</th><th>Task</th><th>Time Today</th><th>Started</th>
          </tr></thead><tbody>
            {liveDevs.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>No active sessions</td></tr>
            ) : liveDevs.map(d => (
              <tr key={d.user_id}>
                <td><strong>{d.full_name}</strong><br /><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.email}</span></td>
                <td>{d.project_name || "—"}</td>
                <td>{d.task_name || "—"}</td>
                <td>{formatDuration(d.active_seconds_today)}</td>
                <td>{new Date(d.session_started_at).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      ) : selectedProject ? (
        /* ── PROJECT DETAIL ── */
        <div>
          <button className="btn btn-secondary" onClick={() => setSelectedProject(null)} style={{ marginBottom: 16 }}>&larr; Back to Projects</button>
          <div className="page-title" style={{ marginBottom: 4 }}>{selectedProject.project.name}</div>
          <div className="page-subtitle" style={{ marginBottom: 20 }}>
            {[selectedProject.project.stageName, selectedProject.project.businessUnit, selectedProject.project.ownerName ? `Owner: ${selectedProject.project.ownerName}` : null].filter(Boolean).join(" · ")}
          </div>

          {detailLoading ? <div className="loading">Loading detail...</div> : (<>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">Team Members ({selectedProject.users.length})</div>
              <div className="table-container"><table><thead><tr>
                <th>Developer</th><th>Active Time</th><th>Idle Time</th><th>Keystrokes</th><th>Saves</th><th>Sessions</th><th>Last Active</th><th>Screenshots</th>
              </tr></thead><tbody>
                {selectedProject.users.map(u => (
                  <tr key={u.user_id}>
                    <td><strong>{u.full_name}</strong><br /><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{u.email}</span></td>
                    <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(u.total_active_seconds)}</td>
                    <td style={{ color: "var(--warning)" }}>{formatDuration(u.total_idle_seconds)}</td>
                    <td>{formatNumber(u.total_keystrokes)}</td>
                    <td>{formatNumber(u.total_file_saves)}</td>
                    <td>{u.session_count}</td>
                    <td>{u.last_active ? new Date(u.last_active).toLocaleDateString() : "—"}</td>
                    <td><a href={`/screenshots?userId=${u.user_id}`} style={{ color: "var(--primary)" }}>View</a></td>
                  </tr>
                ))}
                {selectedProject.users.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>No activity recorded yet</td></tr>
                )}
              </tbody></table></div>
            </div>

            {selectedProject.tasks.length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">Task Breakdown</div>
                <div className="table-container"><table><thead><tr>
                  <th>Task</th><th>Active Time</th><th>Developers</th><th>Sessions</th>
                </tr></thead><tbody>
                  {selectedProject.tasks.map(t => (
                    <tr key={t.task_id}>
                      <td><strong>{t.task_name}</strong></td>
                      <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(t.total_active_seconds)}</td>
                      <td>{t.unique_developers}</td>
                      <td>{t.session_count}</td>
                    </tr>
                  ))}
                </tbody></table></div>
              </div>
            )}

            {selectedProject.daily.length > 0 && (
              <div className="card">
                <div className="card-header">Daily Activity</div>
                <div className="table-container"><table><thead><tr>
                  <th>Date</th><th>Active Time</th><th>Developers</th><th>Sessions</th>
                </tr></thead><tbody>
                  {selectedProject.daily.map(d => (
                    <tr key={d.date}>
                      <td>{new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</td>
                      <td style={{ color: "var(--success)", fontWeight: 600 }}>{formatDuration(d.total_active_seconds)}</td>
                      <td>{d.unique_developers}</td>
                      <td>{d.session_count}</td>
                    </tr>
                  ))}
                </tbody></table></div>
              </div>
            )}
          </>)}
        </div>
      ) : (
        /* ── ALL PROJECTS LIST ── */
        <div>
          <input type="text" placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 400, padding: "8px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", marginBottom: 16, fontSize: 14, outline: "none" }} />
          <div className="card">
            <div className="table-container"><table><thead><tr>
              <th>Project</th><th>Stage</th><th>BU</th><th>Tasks</th><th>Active Time</th><th>Developers</th><th>Sessions</th>
            </tr></thead><tbody>
              {filtered.map(p => (
                <tr key={p.id} onClick={() => loadProjectDetail(p.id)} style={{ cursor: "pointer" }}>
                  <td><strong style={{ color: "var(--primary)" }}>{p.name}</strong>{p.owner_name && <><br /><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.owner_name}</span></>}</td>
                  <td>{p.stage_name || "—"}</td>
                  <td>{p.business_unit || "—"}</td>
                  <td>{p.task_count}</td>
                  <td style={{ fontWeight: p.total_active_seconds > 0 ? 600 : 400, color: p.total_active_seconds > 0 ? "var(--success)" : "var(--text-muted)" }}>
                    {p.total_active_seconds > 0 ? formatDuration(p.total_active_seconds) : "—"}
                  </td>
                  <td>{p.unique_developers || "—"}</td>
                  <td>{p.session_count || "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>No projects found</td></tr>
              )}
            </tbody></table></div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
