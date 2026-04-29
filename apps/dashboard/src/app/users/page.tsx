"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  team: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function UsersPage() {
  const { accessToken, user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    apiFetch<{ data: User[] }>("/api/admin/users", { token: accessToken })
      .then((res) => setUsers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.fullName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">Users</div>
          <div className="page-subtitle">All registered users of Ailancers Code</div>
        </div>
        <div className="stat-value" style={{ fontSize: 28 }}>{users.length}</div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <input
          className="form-input"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 360 }}
        />
      </div>

      {loading ? (
        <div className="loading">Loading users...</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Team</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Last Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {u.avatarUrl ? (
                        <img
                          src={u.avatarUrl}
                          alt={u.fullName}
                          style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 32, height: 32, borderRadius: "50%",
                            background: "var(--primary)", display: "flex",
                            alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 600, color: "#fff",
                          }}
                        >
                          {(u.fullName || u.email)[0].toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 500 }}>{u.fullName || "—"}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <select
                      value={u.role}
                      title={isSuperAdmin ? "Change role" : "Only super admins can promote to Admin/Super Admin"}
                      onChange={async (e) => {
                        const newRole = e.target.value;
                        if (newRole === u.role) return;
                        if (!confirm(`Change ${u.fullName || u.email}'s role to ${newRole}?`)) {
                          e.target.value = u.role;
                          return;
                        }
                        try {
                          await apiFetch(`/api/admin/users/${u.id}/role`, {
                            token: accessToken!,
                            method: "PUT",
                            body: JSON.stringify({ role: newRole }),
                          });
                          setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, role: newRole } : x));
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : String(err);
                          if (msg.includes("403")) {
                            alert("Only super admins can assign Admin or Super Admin roles.");
                          } else {
                            alert("Failed to change role: " + msg);
                          }
                          e.target.value = u.role;
                        }
                      }}
                      style={{
                        background: "var(--bg-card)", color: "var(--text)", border: "1px solid var(--border)",
                        borderRadius: 4, padding: "2px 8px", fontSize: 12, cursor: "pointer",
                      }}
                    >
                      <option value="employee">Employee</option>
                      <option value="developer">Developer</option>
                      <option value="manager">Manager</option>
                      {/* Only super admins can promote to admin / super_admin. The current
                          role stays selectable so admins still see their own row correctly. */}
                      {(isSuperAdmin || u.role === "admin") && (
                        <option value="admin">Admin</option>
                      )}
                      {(isSuperAdmin || u.role === "super_admin") && (
                        <option value="super_admin">Super Admin</option>
                      )}
                    </select>
                  </td>
                  <td style={{ color: u.team ? "var(--text)" : "var(--text-muted)" }}>
                    {u.team || "—"}
                  </td>
                  <td>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      color: u.isActive ? "var(--success)" : "var(--danger)",
                    }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: u.isActive ? "var(--success)" : "var(--danger)",
                        display: "inline-block",
                      }} />
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {timeAgo(u.createdAt)}
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {timeAgo(u.updatedAt)}
                  </td>
                  <td>
                    <Link
                      href={`/developer?id=${u.id}`}
                      className="btn btn-secondary"
                      style={{ padding: "4px 12px", fontSize: 12 }}
                    >
                      View Activity
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
