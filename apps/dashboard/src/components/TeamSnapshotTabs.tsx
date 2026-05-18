"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

// "manager+" tabs roll up team data and don't make sense for a developer
// looking at their own single row. Hide them; backend keeps the manager
// gate on those endpoints separately.
const tabs: Array<{ href: string; label: string; icon: string; managerOnly?: boolean }> = [
  { href: "/team-snapshot/summary",   label: "Summary",       icon: "📊", managerOnly: true },
  { href: "/team-snapshot/bandwidth", label: "Bandwidth",     icon: "📈", managerOnly: true },
  { href: "/team-snapshot",           label: "Team snapshot", icon: "🗓️" },
];

export function TeamSnapshotTabs() {
  const pathname = usePathname();
  const { isManager } = useAuth();
  const visibleTabs = tabs.filter((t) => !t.managerOnly || isManager);

  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
      {visibleTabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`btn ${active ? "btn-primary" : "btn-secondary"}`}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{t.icon}</span> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
