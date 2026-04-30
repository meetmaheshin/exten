"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

type Visibility = "everyone" | "manager" | "admin";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  visibility: Visibility;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// Layout principle: each user sees the section that matches their scope first ("Me",
// then "My Team" for managers, then "Everyone" for admins). Within each section the
// most-used pages come first.
const navGroups: NavGroup[] = [
  {
    title: "My work",
    items: [
      { href: "/me",              label: "My performance",  icon: "📈", visibility: "everyone" },
      { href: "/my-projects",     label: "My projects",     icon: "📁", visibility: "everyone" },
      { href: "/my-screenshots",  label: "My screenshots",  icon: "📸", visibility: "everyone" },
    ],
  },
  {
    title: "My team",
    items: [
      { href: "/my-team",         label: "Team members",    icon: "👥", visibility: "manager" },
      { href: "/team-snapshot",   label: "Team snapshot",   icon: "🗓️", visibility: "manager" },
    ],
  },
  {
    title: "Organization",
    items: [
      { href: "/",                label: "Team overview",   icon: "🏠", visibility: "admin" },
      { href: "/activity",        label: "Daily activity",  icon: "📊", visibility: "admin" },
      { href: "/projects",        label: "All projects",    icon: "📁", visibility: "admin" },
      { href: "/screenshots",     label: "All screenshots", icon: "📸", visibility: "admin" },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/users",           label: "Users & roles",   icon: "🧑‍💻", visibility: "admin" },
      { href: "/employees",       label: "Employees",       icon: "🏢", visibility: "admin" },
      { href: "/holidays",        label: "Holidays",        icon: "🏖️", visibility: "admin" },
      { href: "/leaves",          label: "Leaves",          icon: "🌴", visibility: "manager" },
    ],
  },
  {
    title: "Costs & apps",
    items: [
      { href: "/ai-usage",        label: "AI usage & cost", icon: "🤖", visibility: "admin" },
      { href: "/downloads",       label: "Downloads",       icon: "⬇️", visibility: "everyone" },
    ],
  },
];

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "#ef4444" },
  admin:       { label: "Admin",       color: "#6366f1" },
  manager:     { label: "Manager",     color: "#eab308" },
  developer:   { label: "Developer",   color: "#22c55e" },
  employee:    { label: "Employee",    color: "#3b82f6" },
};

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout, isAdmin, isManager } = useAuth();

  const isVisible = (item: NavItem): boolean => {
    if (item.visibility === "everyone") return true;
    if (item.visibility === "manager") return isManager;
    if (item.visibility === "admin") return isAdmin;
    return false;
  };

  // Drop empty groups so users don't see headers with nothing under them
  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter(isVisible) }))
    .filter((g) => g.items.length > 0);

  const badge = ROLE_BADGE[user?.role || "employee"] || ROLE_BADGE.employee;

  return (
    <aside className="sidebar">
      <div className="sidebar-logo" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src="/dashboard/logo.png" alt="Ailancers" style={{ width: 28, height: 28 }} />
        Ailancers
      </div>
      <nav className="sidebar-nav">
        {groups.map((group, idx) => (
          <div key={group.title} style={{ marginTop: idx === 0 ? 0 : 18 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "var(--text-muted)",
                padding: "4px 12px 6px",
              }}
            >
              {group.title}
            </div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${pathname === item.href ? "active" : ""}`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div style={{ marginBottom: 8 }}>
          <strong>{user?.fullName}</strong>
          <br />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{user?.email}</span>
          <br />
          <span style={{
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 4,
            background: badge.color + "20",
            color: badge.color,
            fontWeight: 600,
          }}>
            {badge.label}
          </span>
        </div>
        <button className="btn btn-secondary" onClick={logout} style={{ width: "100%" }}>
          Sign Out
        </button>
      </div>
    </aside>
  );
}
