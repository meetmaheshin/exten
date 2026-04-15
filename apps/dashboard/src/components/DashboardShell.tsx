"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "./Sidebar";

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      router.push("/login");
    }
  }, [user, router]);

  if (!user) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
