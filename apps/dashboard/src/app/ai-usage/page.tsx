"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatNumber, formatCost, formatDuration, timeAgo } from "@/lib/format";

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

export default function AiUsagePage() {
  const { accessToken } = useAuth();
  const [members, setMembers] = useState<MemberWithAi[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const from = thirtyDaysAgo.toISOString();

    // Get team overview first
    apiFetch<{ data: TeamMember[] }>(
      `/api/admin/activity/overview?from=${from}&limit=100`,
      { token: accessToken }
    )
      .then(async (res) => {
        // For each member, fetch their AI usage
        const enriched = await Promise.all(
          res.data.map(async (m) => {
            try {
              const detail = await apiFetch<{
                aiUsage: UserAiDetail;
              }>(`/api/admin/activity/user/${m.userId}?from=${from}`, {
                token: accessToken!,
              });
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

      <div className="card">
        <div className="card-header">Cost by Developer</div>
        {loading ? (
          <div className="loading">Loading AI usage data...</div>
        ) : (
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
        )}
      </div>
    </DashboardShell>
  );
}
