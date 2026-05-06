import { pgTable, uuid, varchar, boolean, decimal, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { conversations } from "./conversations.js";
import { activitySessions } from "./activitySessions.js";
import { refreshTokens } from "./sessions.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default("developer"),
    team: varchar("team", { length: 100 }),
    isActive: boolean("is_active").notNull().default(true),
    // 'active' | 'on_leave' | 'notice' | 'resigned' | 'maternity' — see migration 0009
    employmentStatus: varchar("employment_status", { length: 20 }).notNull().default("active"),
    // Super-admin kill switch for periodic screen capture (migration 0010).
    // When true, the upload endpoint returns 403 and the extension stops
    // calling captureNow().
    screenshotsDisabled: boolean("screenshots_disabled").notNull().default(false),
    avatarUrl: varchar("avatar_url", { length: 512 }),
    monthlyBudgetUsd: decimal("monthly_budget_usd", { precision: 10, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_users_email").on(table.email),
    index("idx_users_role").on(table.role),
    index("idx_users_team").on(table.team),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  activitySessions: many(activitySessions),
  refreshTokens: many(refreshTokens),
}));
