import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, index, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return "bytea"; },
});
import { relations } from "drizzle-orm";
import { users } from "./users.js";
import { activitySessions } from "./activitySessions.js";
import { projects } from "./projects.js";

export const screenshots = pgTable(
  "screenshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => activitySessions.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    storagePath: text("storage_path").notNull().default(""),
    imageData: bytea("image_data"),
    fileSizeBytes: integer("file_size_bytes").notNull().default(0),
    metadata: jsonb("metadata").default({}),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete columns. Live rows have deleted_at IS NULL; payroll queries
    // MUST filter on this. Kept (not hard-deleted) so HR has an audit trail.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    deletedReason: varchar("deleted_reason", { length: 500 }),
  },
  (table) => [
    index("idx_screenshots_user").on(table.userId),
    index("idx_screenshots_session").on(table.sessionId),
    index("idx_screenshots_captured").on(table.capturedAt),
    index("idx_screenshots_user_date").on(table.userId, table.capturedAt),
  ]
);

export const screenshotsRelations = relations(screenshots, ({ one }) => ({
  user: one(users, { fields: [screenshots.userId], references: [users.id] }),
  session: one(activitySessions, { fields: [screenshots.sessionId], references: [activitySessions.id] }),
  project: one(projects, { fields: [screenshots.projectId], references: [projects.id] }),
}));
