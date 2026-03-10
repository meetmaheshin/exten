export type UserRole = "developer" | "admin" | "super_admin";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  team: string | null;
  isActive: boolean;
  avatarUrl: string | null;
  monthlyBudgetUsd: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserPublic {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  team: string | null;
  avatarUrl: string | null;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  monthlyBudgetUsd: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
