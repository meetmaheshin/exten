"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

interface LeaveRow {
  id: string;
  userId: string;
  userFullName: string | null;
  userEmail: string | null;
  date: string;
  leaveType: "full" | "half" | "sick" | "paid" | "unpaid" | string;
  note: string | null;
  createdAt: string;
}
interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

const LEAVE_TYPES: Array<{ value: string; label: string; color: string }> = [
  { value: "full",   label: "Full day",     color: "#fff3e0" },
  { value: "half",   label: "Half day",     color: "#fff8e1" },
  { value: "sick",   label: "Sick leave",   color: "#fce4ec" },
  { value: "paid",   label: "Paid leave",   color: "#e8f5e9" },
  { value: "unpaid", label: "Unpaid leave", color: "#eceff1" },
];

function leaveTypeLabel(t: string): string {
  return LEAVE_TYPES.find((x) => x.value === t)?.label ?? t;
}

export default function LeavesPage() {
  const { accessToken, isAdmin, isManager } = useAuth();
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [usersList, setUsersList] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Add form state
  const [formUser, setFormUser] = useState("");
  const [formFrom, setFormFrom] = useState("");
  const [formTo, setFormTo] = useState("");
  const [formType, setFormType] = useState<string>("full");
  const [formNote, setFormNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addOk, setAddOk] = useState("");

  async function load() {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [leavesRes, usersRes] = await Promise.all([
        apiFetch<{ data: LeaveRow[] }>("/api/leaves", { token: accessToken }),
        isAdmin
          ? apiFetch<{ data: UserRow[] }>("/api/admin/users", { token: accessToken })
          : Promise.resolve({ data: [] as UserRow[] }),
      ]);
      setLeaves(leavesRes.data);
      setUsersList(usersRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [accessToken, isAdmin]);

  const filtered = useMemo(() => {
    if (!search.trim()) return leaves;
    const q = search.toLowerCase();
    return leaves.filter((l) =>
      (l.userFullName?.toLowerCase().includes(q)) ||
      (l.userEmail?.toLowerCase().includes(q)) ||
      l.leaveType.includes(q) ||
      (l.note?.toLowerCase().includes(q))
    );
  }, [leaves, search]);

  async function add() {
    if (!accessToken || !formUser || !formFrom) return;
    setAdding(true);
    setAddError("");
    setAddOk("");
    try {
      const res = await apiFetch<{ data: LeaveRow[]; skipped: number }>(
        "/api/admin/leaves",
        {
          token: accessToken,
          method: "POST",
          body: JSON.stringify({
            userId: formUser,
            from: formFrom,
            to: formTo || formFrom,
            leaveType: formType,
            note: formNote || undefined,
          }),
        }
      );
      const skippedNote = res.skipped > 0 ? ` (${res.skipped} day${res.skipped === 1 ? "" : "s"} already had leave entries — skipped)` : "";
      setAddOk(`Added ${res.data.length} leave day${res.data.length === 1 ? "" : "s"}${skippedNote}`);
      setFormFrom(""); setFormTo(""); setFormNote("");
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!accessToken) return;
    if (!confirm(`Remove ${label}?`)) return;
    try {
      await apiFetch(`/api/admin/leaves/${id}`, { token: accessToken, method: "DELETE" });
      await load();
    } catch (err) {
      alert("Delete failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  if (!isManager) {
    return (
      <DashboardShell>
        <div className="page-header"><div className="page-title">Leaves</div></div>
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          This page is for managers and admins.
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">Leaves</div>
          <div className="page-subtitle">Days off recorded per employee. These are excluded from working-day counts in Team Snapshot, Bandwidth, and Summary, and shown as "Leave" cells in the snapshot grid.</div>
        </div>
      </div>

      {/* Add form (admin only) */}
      {isAdmin && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Add leave</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={controlLabelStyle}>
              Employee
              <select value={formUser} onChange={(e) => setFormUser(e.target.value)} style={{ ...inputStyle, minWidth: 220 }}>
                <option value="">— pick a user —</option>
                {usersList.slice().sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email)).map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
                ))}
              </select>
            </label>
            <label style={controlLabelStyle}>
              From
              <input type="date" value={formFrom} onChange={(e) => setFormFrom(e.target.value)} style={inputStyle} />
            </label>
            <label style={controlLabelStyle}>
              To <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-muted)" }}>(optional, single day if blank)</span>
              <input type="date" value={formTo} onChange={(e) => setFormTo(e.target.value)} style={inputStyle} />
            </label>
            <label style={controlLabelStyle}>
              Type
              <select value={formType} onChange={(e) => setFormType(e.target.value)} style={inputStyle}>
                {LEAVE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label style={{ ...controlLabelStyle, flex: 1, minWidth: 220 }}>
              Note <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-muted)" }}>(optional)</span>
              <input type="text" value={formNote} onChange={(e) => setFormNote(e.target.value)} style={inputStyle} placeholder="e.g. flu, family event" maxLength={500} />
            </label>
            <button className="btn btn-primary" onClick={add} disabled={!formUser || !formFrom || adding} style={{ height: 36 }}>
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
          {addError && <div style={{ color: "var(--danger)", marginTop: 10, fontSize: 12 }}>{addError}</div>}
          {addOk && <div style={{ color: "var(--success)", marginTop: 10, fontSize: 12 }}>{addOk}</div>}
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>
            Adding a date range automatically skips weekends, and re-adding a day already on leave is a no-op (no errors). Capped at 31 days per add.
          </div>
        </div>
      )}

      {/* Search */}
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by employee, email, type, or note…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />
      </div>

      {loading ? (
        <div className="loading">Loading leaves…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          {leaves.length === 0 ? "No leaves recorded yet." : "No leaves match your search."}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
            <thead>
              <tr style={{ background: "var(--bg-secondary)" }}>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Employee</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Note</th>
                {isAdmin && <th style={thStyle}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const typeMeta = LEAVE_TYPES.find((t) => t.value === l.leaveType);
                return (
                  <tr key={l.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={tdStyle}>
                      {new Date(`${l.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500 }}>{l.userFullName ?? "Unknown"}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.userEmail}</div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        background: typeMeta?.color ?? "#eceff1",
                        color: "#5d4037",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                      }}>
                        {leaveTypeLabel(l.leaveType)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-muted)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {l.note || "—"}
                    </td>
                    {isAdmin && (
                      <td style={{ ...tdStyle, textAlign: "right", width: 100 }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => remove(l.id, `${leaveTypeLabel(l.leaveType)} for ${l.userFullName} on ${l.date}`)}
                          style={{ padding: "4px 12px", fontSize: 12 }}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  borderBottom: "1px solid var(--border)",
  fontWeight: 600,
  fontSize: 11,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  whiteSpace: "nowrap",
};

const controlLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  fontSize: 11,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 600,
  gap: 4,
};

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  background: "var(--bg-card)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 13,
  textTransform: "none",
  fontWeight: 400,
};
