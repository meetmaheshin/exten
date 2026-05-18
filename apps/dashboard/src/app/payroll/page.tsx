"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { API_BASE } from "@/lib/api";

// Default range = current calendar month. HR's first click of the month
// gets them exactly what they want; date pickers below let them override
// for catch-up runs or backfills.
function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-01`;
}
function endOfMonth(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${(last.getMonth() + 1).toString().padStart(2, "0")}-${last.getDate().toString().padStart(2, "0")}`;
}

export default function PayrollPage() {
  const { accessToken, user, isSuperAdmin, loading } = useAuth();
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(endOfMonth());
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filename = useMemo(() => `ailancers-payroll-${from}-to-${to}.csv`, [from, to]);

  const download = async () => {
    if (!accessToken) return;
    setError(null);
    setDownloading(true);
    try {
      const url = `${API_BASE}/api/admin/payroll/csv?from=${from}&to=${to}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Server returned ${resp.status}: ${text}`);
      }
      const blob = await resp.blob();
      // Force-download by creating a temp anchor — fetch responses don't
      // trigger the browser save dialog automatically.
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  // Render the access gate AFTER we know who the user is. While loading,
  // show the shell — flashing "access denied" before the role hydrates is
  // a worse UX than a half-second blank state.
  if (loading) {
    return (
      <DashboardShell>
        <div className="loading">Checking permissions…</div>
      </DashboardShell>
    );
  }
  if (!isSuperAdmin) {
    return (
      <DashboardShell>
        <div className="page-header">
          <div className="page-title">Payroll Export</div>
          <div className="page-subtitle" style={{ color: "var(--warning)" }}>
            Restricted to super admins. Ask {user?.role === "admin" ? "the platform owner" : "an admin"} for access.
          </div>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <div className="page-header">
        <div className="page-title">Payroll Export</div>
        <div className="page-subtitle">
          Monthly hours per employee, day-by-day, as CSV. Hours come from screenshot-verified active time —
          deleted or missing screenshots automatically reduce the count.
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Date range</div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={{ background: "var(--bg-card)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 14 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={{ background: "var(--bg-card)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 14 }}
              />
            </label>
            <button
              onClick={() => { setFrom(startOfMonth()); setTo(endOfMonth()); }}
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", alignSelf: "flex-end" }}
            >
              This month
            </button>
          </div>
          <button
            onClick={download}
            disabled={downloading || !accessToken}
            style={{
              alignSelf: "flex-start",
              background: downloading ? "var(--bg-card)" : "var(--primary)",
              color: downloading ? "var(--text-muted)" : "#fff",
              border: "none",
              borderRadius: 6,
              padding: "10px 20px",
              fontWeight: 600,
              fontSize: 14,
              cursor: downloading ? "not-allowed" : "pointer",
            }}
          >
            {downloading ? "Generating…" : "Download CSV"}
          </button>
          {error && (
            <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 6, border: "1px solid var(--danger)" }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">CSV format</div>
        <div style={{ padding: 16, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          <p>One row per employee from the HR directory. One column per day in the date range, plus a Total Hours column.</p>
          <p>Cells contain decimal hours (e.g. <code>7.50</code> = 7h30m). Non-working days show labels instead:</p>
          <ul style={{ marginLeft: 20, marginTop: 4 }}>
            <li><strong>Sun / Sat</strong> — weekend</li>
            <li><strong>Holiday name</strong> — company holiday</li>
            <li><strong>Leave / Half day / Sick leave / Paid leave / Unpaid leave</strong> — approved leave</li>
            <li><em>Empty</em> — employee in directory but never logged into the tracker</li>
          </ul>
          <p style={{ marginTop: 12 }}>Active time is screenshot-derived: each screenshot represents 5 minutes of verified work. Deleted screenshots automatically subtract from the total.</p>
        </div>
      </div>
    </DashboardShell>
  );
}
