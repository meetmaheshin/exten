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
  const { accessToken } = useAuth();
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
                    <span className={`badge ${u.role === "admin" || u.role === "super_admin" ? "badge-primary" : ""}`}>
                      {u.role}
                    </span>
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
