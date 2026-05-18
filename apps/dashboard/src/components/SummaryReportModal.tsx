"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

// ─── Types matching the /api/team-snapshot/summary response ───
interface Performer {
  name: string;
  manager: string;
  hours: number;
}
interface UnderutilizedManager {
  name: string;
  redCount: number;
  totalCount: number;
  percent: number;
}
interface SummaryResponse {
  totalActiveEmployees: number;
  workingDays: number;
  avgHoursPerEmployeePerDay: number;
  distribution: { good: number; moderate: number; low: number; none: number };
  underperformers: Performer[];
  underutilizedManagers: UnderutilizedManager[];
  notLogged: string[];
}

type Preset = "yesterday" | "week" | "month";

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-01`;
}

// "This Week" mirrors Cattr: last 7 days rolling (NOT Monday-start). The
// summary endpoint excludes today already (today is "in progress"), so
// the actual window is yesterday → 7 days back.
function rangeForPreset(p: Preset): { from: string; to: string; label: string } {
  const yest = dateNDaysAgo(1);
  const yestLabel = new Date(`${yest}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  if (p === "yesterday") return { from: yest, to: yest, label: yestLabel };
  if (p === "week") {
    const from = dateNDaysAgo(7);
    return { from, to: yest, label: `${from} → ${yest}` };
  }
  return { from: startOfMonth(), to: yest, label: `${startOfMonth()} → ${yest}` };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal version of the Summary Report. Lifted from /team-snapshot/summary
 * page so the same view opens from a button on the main snapshot grid.
 * Mirrors Cattr's section layout (Underperformers + Underutilized Managers
 * + Not Logged + Performance Distribution) on top of our existing KPIs.
 */
export function SummaryReportModal({ open, onClose }: Props) {
  const { accessToken } = useAuth();
  const [preset, setPreset] = useState<Preset>("yesterday");
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const range = useMemo(() => rangeForPreset(preset), [preset]);

  useEffect(() => {
    if (!open || !accessToken) return;
    setLoading(true);
    apiFetch<SummaryResponse>(
      `/api/team-snapshot/summary?from=${range.from}&to=${range.to}`,
      { token: accessToken },
    )
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, accessToken, range.from, range.to]);

  if (!open) return null;

  const total = data
    ? data.distribution.good + data.distribution.moderate + data.distribution.low
    : 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-card)", borderRadius: 10, padding: 24,
          width: "100%", maxWidth: 780, maxHeight: "90vh", overflow: "auto",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 700 }}>
            📊 Summary Report
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
        </div>

        {/* Preset toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {([
            { value: "yesterday", label: "📅 Yesterday" },
            { value: "week", label: "📆 This Week" },
            { value: "month", label: "🗓️ This Month" },
          ] as Array<{ value: Preset; label: string }>).map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={`btn ${preset === p.value ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          📅 Period: <strong style={{ color: "var(--text)" }}>{range.label}</strong>
        </div>

        {loading ? (
          <div className="loading">Loading summary…</div>
        ) : !data ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>No data.</div>
        ) : (
          <>
            {/* KPI rows */}
            <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 0, marginBottom: 16, overflow: "hidden" }}>
              <KpiRow label="Total Active Employees" value={String(data.totalActiveEmployees)} />
              <KpiRow label="Working Days in Period" value={String(data.workingDays)} />
              <KpiRow
                label="Avg Hours/Employee/Day"
                value={`${data.avgHoursPerEmployeePerDay.toFixed(1)} hrs`}
                valueColor={
                  data.avgHoursPerEmployeePerDay >= 7 ? "var(--success)"
                    : data.avgHoursPerEmployeePerDay >= 4 ? "var(--warning)"
                      : "var(--danger)"
                }
                last
              />
            </div>

            {/* Underutilized Managers — render only when there's something to flag */}
            {data.underutilizedManagers.length > 0 && (
              <Section title="⚠️ Underutilized Managers (20%+ team red)" tone="warning">
                {data.underutilizedManagers.map((m) => (
                  <ListRow
                    key={m.name}
                    primary={m.name}
                    value={<span style={{ color: "var(--danger)" }}>{m.redCount}/{m.totalCount} ({m.percent}%)</span>}
                  />
                ))}
              </Section>
            )}

            {/* Underperformers */}
            {data.underperformers.length > 0 && (
              <Section title="🔴 Underperformers (<4 hrs/day avg)" tone="danger">
                <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 12px 8px" }}>
                  Count <strong style={{ color: "var(--danger)", float: "right" }}>{data.underperformers.length}</strong>
                </div>
                {data.underperformers.slice(0, 15).map((p) => (
                  <ListRow
                    key={p.name}
                    primary={<>{p.name} <small style={{ color: "var(--text-muted)" }}>({p.manager})</small></>}
                    value={<span style={{ color: "var(--danger)" }}>{p.hours.toFixed(1)} hrs</span>}
                  />
                ))}
                {data.underperformers.length > 15 && (
                  <ListRow primary={<em style={{ color: "var(--text-muted)" }}>…and {data.underperformers.length - 15} more</em>} />
                )}
              </Section>
            )}

            {/* Not Logged */}
            {data.notLogged.length > 0 && (
              <Section title="❓ Not Logged (Didn't Track Time)" tone="muted">
                <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 12px 8px" }}>
                  Count <strong style={{ float: "right" }}>{data.notLogged.length}</strong>
                </div>
                {data.notLogged.slice(0, 10).map((n) => (
                  <ListRow key={n} primary={n} />
                ))}
                {data.notLogged.length > 10 && (
                  <ListRow primary={<em style={{ color: "var(--text-muted)" }}>…and {data.notLogged.length - 10} more</em>} />
                )}
              </Section>
            )}

            {/* Performance Distribution — always render, anchors the report */}
            <Section title="📈 Performance Distribution">
              <DistRow color="#4caf50" label="Good (7+ hrs)"     count={data.distribution.good}     total={total} />
              <DistRow color="#ff9800" label="Moderate (4–7 hrs)" count={data.distribution.moderate} total={total} />
              <DistRow color="#ef5350" label="Low (<4 hrs)"       count={data.distribution.low}      total={total} />
              {data.distribution.none > 0 && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  {data.distribution.none} employee-days had no activity (excluded from the bands above).
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function KpiRow({ label, value, valueColor, last }: { label: string; value: string; valueColor?: string; last?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "12px 16px",
      borderBottom: last ? "none" : "1px solid var(--border)",
    }}>
      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: 16, color: valueColor || "var(--text)" }}>{value}</span>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone?: "warning" | "danger" | "muted"; children: React.ReactNode }) {
  const borderColor =
    tone === "warning" ? "rgba(251,191,36,0.3)"
    : tone === "danger" ? "rgba(239,68,68,0.3)"
    : "var(--border)";
  return (
    <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12, marginBottom: 14, border: `1px solid ${borderColor}` }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, padding: "0 4px" }}>{title}</div>
      {children}
    </div>
  );
}

function ListRow({ primary, value }: { primary: React.ReactNode; value?: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 12px", fontSize: 13,
      borderTop: "1px solid var(--border)",
    }}>
      <span>{primary}</span>
      {value && <span style={{ fontWeight: 600, fontSize: 13 }}>{value}</span>}
    </div>
  );
}

function DistRow({ color, label, count, total }: { color: string; label: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "6px 4px", gap: 12 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
      <div style={{ width: 140, height: 6, background: "var(--bg-card)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <span style={{ width: 30, textAlign: "right", fontWeight: 700, fontSize: 13, color }}>{count}</span>
    </div>
  );
}
