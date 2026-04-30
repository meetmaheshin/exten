"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs: Array<{ href: string; label: string; icon: string }> = [
  { href: "/team-snapshot/summary",   label: "Summary",       icon: "📊" },
  { href: "/team-snapshot/bandwidth", label: "Bandwidth",     icon: "📈" },
  { href: "/team-snapshot",           label: "Team snapshot", icon: "🗓️" },
];

export function TeamSnapshotTabs() {
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
      {tabs.map((t) => {
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
