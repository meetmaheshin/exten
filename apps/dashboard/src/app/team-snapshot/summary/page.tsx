"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { TeamSnapshotTabs } from "@/components/TeamSnapshotTabs";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

interface SummaryResponse {
  totalActiveEmployees: number;
  workingDays: number;
  avgHoursPerEmployeePerDay: number;
  distribution: { good: number; moderate: number; low: number; none: number };
}

type Preset = "yesterday" | "week" | "month";

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function startOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}
function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-01`;
}

function rangeForPreset(p: Preset): { from: string; to: string; label: string } {
  const yest = dateNDaysAgo(1);
  const yestLabel = new Date(`${yest}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (p === "yesterday") return { from: yest, to: yest, label: yestLabel };
  if (p === "week") return { from: startOfWeek(), to: yest, label: `${startOfWeek()} → ${yest}` };
  return { from: startOfMonth(), to: yest, label: `${startOfMonth()} → ${yest}` };
}

export default function SummaryPage() {
  const { accessToken, isManager } = useAuth();
  const [preset, setPreset] = useState<Preset>("yesterday");
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => rangeForPreset(preset), [preset]);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    apiFetch<SummaryResponse>(
      `/api/team-snapshot/summary?from=${range.from}&to=${range.to}`,
      { token: accessToken }
    )
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken, range.from, range.to]);

  if (!isManager) {
    return (
      <DashboardShell>
        <div className="page-header">
          <div className="page-title">Summary Report</div>
        </div>
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          This page is for managers and admins.
        </div>
      </DashboardShell>
    );
  }

  const total = data
    ? data.distribution.good + data.distribution.moderate + data.distribution.low
    : 0;

  return (
    <DashboardShell>
      <TeamSnapshotTabs />

      <div className="page-header">
        <div>
          <div className="page-title">Summary Report</div>
          <div className="page-subtitle">High-level KPIs for the selected period</div>
        </div>
      </div>

      {/* Preset toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {([
          { value: "yesterday", label: "📅 Yesterday" },
          { value: "week", label: "📅 This Week" },
          { value: "month", label: "📅 This Month" },
        ] as Array<{ value: Preset; label: string }>).map((p) => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={`btn ${preset === p.value ? "btn-primary" : "btn-secondary"}`}
            style={{ padding: "8px 18px" }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>🗓️ Period: {range.label}</div>
      </div>

      {loading ? (
        <div className="loading">Loading summary…</div>
      ) : !data ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          No data.
        </div>
      ) : (
        <>
          {/* KPI rows */}
          <div className="card" style={{ padding: 0, marginBottom: 16, overflow: "hidden" }}>
            <KpiRow label="Total Active Employees" value={String(data.totalActiveEmployees)} />
            <KpiRow label="Working Days in Period" value={String(data.workingDays)} />
            <KpiRow
              label="Avg Hours / Employee / Day"
              value={`${data.avgHoursPerEmployeePerDay.toFixed(1)} hrs`}
              valueColor={
                data.avgHoursPerEmployeePerDay >= 7 ? "var(--success)"
                  : data.avgHoursPerEmployeePerDay >= 4 ? "var(--warning)"
                    : "var(--danger)"
              }
              last
            />
          </div>

          {/* Distribution */}
          <div className="card" style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>📈 Performance Distribution</div>
            <DistRow color="#4caf50" label="Good (7+ hrs)"     count={data.distribution.good}     total={total} />
            <DistRow color="#ff9800" label="Moderate (4–7 hrs)" count={data.distribution.moderate} total={total} />
            <DistRow color="#ef5350" label="Low (<4 hrs)"       count={data.distribution.low}      total={total} />
            {data.distribution.none > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>
                {data.distribution.none} employee-days had no activity (excluded from the bands above).
              </div>
            )}
          </div>
        </>
      )}
    </DashboardShell>
  );
}

function KpiRow({ label, value, valueColor, last }: { label: string; value: string; valueColor?: string; last?: boolean }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "14px 20px",
      borderBottom: last ? "none" : "1px solid var(--border)",
    }}>
      <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: 18, color: valueColor || "var(--text)" }}>{value}</span>
    </div>
  );
}

function DistRow({ color, label, count, total }: { color: string; label: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "10px 0", gap: 12 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 14 }}>{label}</span>
      <div style={{ width: 200, height: 8, background: "var(--bg-secondary)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <span style={{ width: 50, textAlign: "right", fontWeight: 700, fontSize: 14 }}>{count}</span>
    </div>
  );
}
