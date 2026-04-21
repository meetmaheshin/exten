"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "./Sidebar";

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Wait until auth check is done before redirecting
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Still checking auth — show loading
  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  // Not logged in — will redirect
  if (!user) {
    return <div className="loading">Redirecting to login...</div>;
  }

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
