"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: ("all" | "admin" | "manager")[];
}

const navItems: NavItem[] = [
  // Everyone
  { href: "/me", label: "My Performance", icon: "📈", roles: ["all"] },
  { href: "/my-projects", label: "My Projects", icon: "📁", roles: ["all"] },
  { href: "/my-screenshots", label: "My Screenshots", icon: "📸", roles: ["all"] },
  // Manager + Admin
  { href: "/my-team", label: "My Team", icon: "👥", roles: ["manager"] },
  // Admin only
  { href: "/", label: "Team Overview", icon: "🏠", roles: ["admin"] },
  { href: "/projects", label: "All Projects", icon: "📁", roles: ["admin"] },
  { href: "/users", label: "Users", icon: "🧑‍💻", roles: ["admin"] },
  { href: "/activity", label: "Activity", icon: "📊", roles: ["admin"] },
  { href: "/ai-usage", label: "AI Usage & Cost", icon: "🤖", roles: ["admin"] },
  { href: "/screenshots", label: "All Screenshots", icon: "📸", roles: ["admin"] },
  { href: "/employees", label: "Employees", icon: "🏢", roles: ["admin"] },
  { href: "/downloads", label: "Downloads", icon: "⬇️", roles: ["admin"] },
];

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "#ef4444" },
  admin: { label: "Admin", color: "#6366f1" },
  manager: { label: "Manager", color: "#eab308" },
  developer: { label: "Developer", color: "#22c55e" },
  employee: { label: "Employee", color: "#3b82f6" },
};

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout, isAdmin, isManager } = useAuth();

  const visibleItems = navItems.filter((item) => {
    if (item.roles.includes("all")) return true;
    if (item.roles.includes("admin") && isAdmin) return true;
    if (item.roles.includes("manager") && isManager) return true;
    return false;
  });

  const badge = ROLE_BADGE[user?.role || "employee"] || ROLE_BADGE.employee;

  return (
    <aside className="sidebar">
      <div className="sidebar-logo" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src="/dashboard/logo.png" alt="Ailancers" style={{ width: 28, height: 28 }} />
        Ailancers
      </div>
      <nav className="sidebar-nav">
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${pathname === item.href ? "active" : ""}`}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
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
