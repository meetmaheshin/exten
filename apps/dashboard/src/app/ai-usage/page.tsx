"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatNumber, formatCost, formatDuration } from "@/lib/format";

interface TeamMember {
  userId: string;
  email: string;
  fullName: string;
  team: string | null;
  totalActiveSeconds: number;
  totalKeystrokes: number;
  sessionCount: number;
  lastActive: string;
}

interface UserAiDetail {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
}

interface MemberWithAi extends TeamMember {
  ai: UserAiDetail | null;
}

interface DailyUsage {
  date: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
  uniqueUsers: number;
}

export default function AiUsagePage() {
  const { accessToken } = useAuth();
  const [members, setMembers] = useState<MemberWithAi[]>([]);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"daily" | "developer">("daily");

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromParam = thirtyDaysAgo.toISOString();

  useEffect(() => {
    if (!accessToken) return;

    Promise.all([
      // Fetch daily AI usage
      apiFetch<{ data: DailyUsage[] }>(
        `/api/admin/ai-usage/daily?from=${fromParam}&limit=100`,
        { token: accessToken }
      ),
      // Fetch team overview for developer breakdown
      apiFetch<{ data: TeamMember[] }>(
        `/api/admin/activity/overview?from=${fromParam}&limit=100`,
        { token: accessToken }
      ),
    ])
      .then(async ([dailyRes, teamRes]) => {
        setDailyUsage(dailyRes.data);

        // Enrich each member with AI usage
        const enriched = await Promise.all(
          teamRes.data.map(async (m) => {
            try {
              const detail = await apiFetch<{ aiUsage: UserAiDetail }>(
                `/api/admin/activity/user/${m.userId}?from=${fromParam}`,
                { token: accessToken! }
              );
              return { ...m, ai: detail.aiUsage };
            } catch {
              return { ...m, ai: null };
            }
          })
        );
        setMembers(enriched);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  const totalRequests = members.reduce((s, m) => s + (m.ai?.totalRequests ?? 0), 0);
  const totalInputTokens = members.reduce((s, m) => s + (m.ai?.totalInputTokens ?? 0), 0);
  const totalOutputTokens = members.reduce((s, m) => s + (m.ai?.totalOutputTokens ?? 0), 0);
  const totalCost = members.reduce((s, m) => s + parseFloat(m.ai?.totalCostUsd ?? "0"), 0);

  return (
    <DashboardShell>
      <div className="page-header">
        <div className="page-title">AI Usage & Cost</div>
        <div className="page-subtitle">Claude API usage across the team (last 30 days)</div>
      </div>

      <div className="stats-grid">
        <StatCard value={formatNumber(totalRequests)} label="Total AI Requests" color="blue" />
        <StatCard value={formatNumber(totalInputTokens)} label="Input Tokens" color="green" />
        <StatCard value={formatNumber(totalOutputTokens)} label="Output Tokens" color="yellow" />
        <StatCard value={formatCost(totalCost)} label="Total Cost" color="purple" />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["daily", "developer"] as const).map((t) => (
          <button
            key={t}
            className={`btn ${tab === t ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab(t)}
            style={{ minWidth: 120 }}
          >
            {t === "daily" ? "📅 Daily Breakdown" : "👤 By Developer"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading AI usage data...</div>
      ) : tab === "daily" ? (
        /* ── DAILY BREAKDOWN ── */
        <div className="card">
          <div className="card-header">Daily AI Usage</div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Requests</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  <th>Cost</th>
                  <th>Users</th>
                </tr>
              </thead>
              <tbody>
                {dailyUsage.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                      No AI usage data yet
                    </td>
                  </tr>
                ) : (
                  dailyUsage.map((d) => {
                    const cost = parseFloat(d.totalCostUsd);
                    const dateObj = new Date(d.date + "T00:00:00");
                    const dateStr = dateObj.toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    });
                    const isToday = d.date === new Date().toISOString().slice(0, 10);

                    return (
                      <tr key={d.date} style={isToday ? { background: "var(--primary)10" } : {}}>
                        <td>
                          <span style={{ fontWeight: isToday ? 700 : 400 }}>
                            {dateStr}
                            {isToday && (
                              <span style={{
                                marginLeft: 8,
                                fontSize: 10,
                                background: "var(--primary)",
                                color: "white",
                                padding: "1px 6px",
                                borderRadius: 4,
                              }}>
                                Today
                              </span>
                            )}
                          </span>
                        </td>
                        <td>{formatNumber(d.totalRequests)}</td>
                        <td>{formatNumber(d.totalInputTokens)}</td>
                        <td>{formatNumber(d.totalOutputTokens)}</td>
                        <td style={{
                          fontWeight: 600,
                          color: cost > 10 ? "var(--danger)" : cost > 5 ? "var(--warning)" : "var(--success)",
                        }}>
                          {formatCost(cost)}
                        </td>
                        <td>{d.uniqueUsers}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── BY DEVELOPER ── */
        <div className="card">
          <div className="card-header">Cost by Developer</div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Developer</th>
                  <th>Team</th>
                  <th>AI Requests</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  <th>Cost</th>
                  <th>Active Time</th>
                  <th>Cost/Hour</th>
                </tr>
              </thead>
              <tbody>
                {members
                  .sort((a, b) => parseFloat(b.ai?.totalCostUsd ?? "0") - parseFloat(a.ai?.totalCostUsd ?? "0"))
                  .map((m) => {
                    const cost = parseFloat(m.ai?.totalCostUsd ?? "0");
                    const hours = m.totalActiveSeconds / 3600;
                    const costPerHour = hours > 0 ? cost / hours : 0;

                    return (
                      <tr key={m.userId}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div className="avatar">
                              {m.fullName
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)}
                            </div>
                            <div>
                              <div style={{ fontWeight: 500 }}>{m.fullName}</div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>{m.team || "—"}</td>
                        <td>{formatNumber(m.ai?.totalRequests ?? 0)}</td>
                        <td>{formatNumber(m.ai?.totalInputTokens ?? 0)}</td>
                        <td>{formatNumber(m.ai?.totalOutputTokens ?? 0)}</td>
                        <td style={{ fontWeight: 600, color: cost > 50 ? "var(--danger)" : cost > 20 ? "var(--warning)" : "var(--success)" }}>
                          {formatCost(cost)}
                        </td>
                        <td>{formatDuration(m.totalActiveSeconds)}</td>
                        <td>{formatCost(costPerHour)}/hr</td>
                      </tr>
                    );
                  })}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                      No AI usage data yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
