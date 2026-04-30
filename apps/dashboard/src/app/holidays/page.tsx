"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

interface Holiday {
  id: string;
  date: string;
  name: string;
}

export default function HolidaysPage() {
  const { accessToken, isAdmin } = useAuth();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ data: Holiday[] }>("/api/holidays", { token: accessToken });
      setHolidays(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [accessToken]);

  async function add() {
    if (!accessToken || !date || !name.trim()) return;
    setAdding(true);
    setError("");
    try {
      await apiFetch("/api/admin/holidays", {
        token: accessToken,
        method: "POST",
        body: JSON.stringify({ date, name: name.trim() }),
      });
      setDate("");
      setName("");
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("409") ? "A holiday is already set for that date." : msg);
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string, dateLabel: string) {
    if (!accessToken) return;
    if (!confirm(`Remove holiday on ${dateLabel}?`)) return;
    try {
      await apiFetch(`/api/admin/holidays/${id}`, { token: accessToken, method: "DELETE" });
      await load();
    } catch (err) {
      alert("Delete failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  if (!isAdmin) {
    return (
      <DashboardShell>
        <div className="page-header"><div className="page-title">Holidays</div></div>
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          Only admins can manage company holidays.
        </div>
      </DashboardShell>
    );
  }

  // Group by year for readability
  const byYear = new Map<string, Holiday[]>();
  for (const h of holidays) {
    const y = h.date.slice(0, 4);
    const list = byYear.get(y) || [];
    list.push(h);
    byYear.set(y, list);
  }

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">Holidays</div>
          <div className="page-subtitle">Company-wide non-working days. These are excluded from working-day counts in Team Snapshot, Bandwidth, and Summary.</div>
        </div>
      </div>

      {/* Add form */}
      <div className="card" style={{ padding: 16, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={controlLabelStyle}>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ ...controlLabelStyle, flex: 1, minWidth: 200 }}>
          Name
          <input
            type="text"
            placeholder="e.g. Diwali, Christmas Day"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            maxLength={100}
          />
        </label>
        <button
          className="btn btn-primary"
          onClick={add}
          disabled={!date || !name.trim() || adding}
          style={{ height: 36 }}
        >
          {adding ? "Adding…" : "Add holiday"}
        </button>
        {error && <div style={{ flexBasis: "100%", color: "var(--danger)", fontSize: 12 }}>{error}</div>}
      </div>

      {loading ? (
        <div className="loading">Loading holidays…</div>
      ) : holidays.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          No holidays yet. Add one above to start excluding it from working-day calculations.
        </div>
      ) : (
        Array.from(byYear.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([year, list]) => (
          <div key={year} className="card" style={{ padding: 0, marginBottom: 16, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13 }}>
              {year} <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 12, marginLeft: 8 }}>({list.length} days)</span>
            </div>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
              <tbody>
                {list.map((h) => {
                  const d = new Date(`${h.date}T00:00:00`);
                  const dayName = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
                  return (
                    <tr key={h.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 16px", width: 200, color: "var(--text-muted)" }}>{dayName}</td>
                      <td style={{ padding: "10px 16px", fontWeight: 500 }}>{h.name}</td>
                      <td style={{ padding: "10px 16px", textAlign: "right", width: 100 }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => remove(h.id, dayName)}
                          style={{ padding: "4px 12px", fontSize: 12 }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </DashboardShell>
  );
}

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
