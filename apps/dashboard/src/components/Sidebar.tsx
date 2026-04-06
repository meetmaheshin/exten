"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

const navItems = [
  { href: "/", label: "Team Overview", icon: "👥" },
  { href: "/projects", label: "Projects", icon: "📁" },
  { href: "/users", label: "Users", icon: "🧑‍💻" },
  { href: "/activity", label: "Activity", icon: "📊" },
  { href: "/ai-usage", label: "AI Usage & Cost", icon: "🤖" },
  { href: "/screenshots", label: "Screenshots", icon: "📸" },
  { href: "/employees", label: "Employees", icon: "🏢" },
  { href: "/downloads", label: "Downloads", icon: "⬇️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">Ailancers Admin</div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
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
          <span style={{ fontSize: 11 }}>{user?.email}</span>
        </div>
        <button className="btn btn-secondary" onClick={logout} style={{ width: "100%" }}>
          Sign Out
        </button>
      </div>
    </aside>
  );
}
