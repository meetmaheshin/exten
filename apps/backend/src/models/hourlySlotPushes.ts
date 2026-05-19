import { pgTable, uuid, text, integer, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.js";
import { screenshots } from "./screenshots.js";

export const hourlySlotPushes = pgTable(
  "hourly_slot_pushes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subProjectId: uuid("sub_project_id").notNull(),
    slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
    lancerUserId: text("lancer_user_id").notNull(),
    keystrokesAtPush: integer("keystrokes_at_push").notNull().default(0),
    mouseHitsAtPush: integer("mouse_hits_at_push").notNull().default(0),
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
