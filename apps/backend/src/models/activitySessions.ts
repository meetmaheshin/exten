import { pgTable, uuid, varchar, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.js";
import { projects } from "./projects.js";

export const activitySessions = pgTable(
  "activity_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    activeSeconds: integer("active_seconds").notNull().default(0),
    idleSeconds: integer("idle_seconds").notNull().default(0),
    totalKeystrokes: integer("total_keystrokes").notNull().default(0),
    totalFileSaves: integer("total_file_saves").notNull().default(0),
    totalFileChanges: integer("total_file_changes").notNull().default(0),
    filesTouched: jsonb("files_touched").default([]),
    languagesUsed: jsonb("languages_used").default({}),
    editorVersion: varchar("editor_version", { length: 50 }),
    extensionVersion: varchar("extension_version", { length: 20 }),
    osPlatform: varchar("os_platform", { length: 30 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_activity_user").on(table.userId),
    index("idx_activity_project").on(table.projectId),
    index("idx_activity_started").on(table.startedAt),
    index("idx_activity_user_date").on(table.userId, table.startedAt),
  ]
);

export const activitySessionsRelations = relations(activitySessions, ({ one }) => ({
  user: one(users, { fields: [activitySessions.userId], references: [users.id] }),
  project: one(projects, { fields: [activitySessions.projectId], references: [projects.id] }),
}));
