import { pgTable, uuid, varchar, text, integer, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.js";
import { screenshots } from "./screenshots.js";

export const hourlySlotPushes = pgTable(
  "hourly_slot_pushes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // varchar(64) — matches screenshots.sub_project_id type. See migration
    // 0014. Platform UUIDs flow as strings throughout the codebase.
    subProjectId: varchar("sub_project_id", { length: 64 }).notNull(),
    slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
    lancerUserId: text("lancer_user_id").notNull(),
    keystrokesAtPush: integer("keystrokes_at_push").notNull().default(0),
    mouseHitsAtPush: integer("mouse_hits_at_push").notNull().default(0),
    // Session-cumulative active/idle seconds at push time (migration 0017).
    // Delta vs the previous slot's snapshot drives the activity_percent
    // fallback when kb/mouse hooks aren't available on the desktop tracker.
    activeSecondsAtPush: integer("active_seconds_at_push").notNull().default(0),
    idleSecondsAtPush: integer("idle_seconds_at_push").notNull().default(0),
    screenshotId: uuid("screenshot_id").references(() => screenshots.id, {
      onDelete: "set null",
    }),
    pushedAt: timestamp("pushed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.subProjectId, table.slotStart] }),
    index("idx_hourly_slot_pushes_latest").on(
      table.userId,
      table.subProjectId,
      table.slotStart,
    ),
  ],
);

export const hourlySlotPushesRelations = relations(hourlySlotPushes, ({ one }) => ({
  user: one(users, { fields: [hourlySlotPushes.userId], references: [users.id] }),
  screenshot: one(screenshots, {
    fields: [hourlySlotPushes.screenshotId],
    references: [screenshots.id],
  }),
}));
