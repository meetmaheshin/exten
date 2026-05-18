"use client";

import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { TeamSnapshotTabs } from "@/components/TeamSnapshotTabs";
import { SummaryReportModal } from "@/components/SummaryReportModal";
import { useAuth } from "@/lib/auth";

/**
 * Legacy route. The Summary Report was a full page; it's now a modal opened
 * from /team-snapshot. We keep this URL alive so existing bookmarks still
 * land somewhere useful: render the modal directly, and close-action routes
 * back to /team-snapshot.
 */
export default function SummaryPage() {
  const router = useRouter();
  const { isManager } = useAuth();

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

  return (
    <DashboardShell>
      <TeamSnapshotTabs />
      <div className="page-header">
        <div>
          <div className="page-title">Summary Report</div>
          <div className="page-subtitle">High-level KPIs for the selected period</div>
        </div>
      </div>
      <SummaryReportModal open={true} onClose={() => router.push("/team-snapshot")} />
    </DashboardShell>
  );
}
