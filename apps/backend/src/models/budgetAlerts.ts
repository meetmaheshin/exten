import { pgTable, uuid, varchar, integer, date, timestamp } from "drizzle-orm/pg-core";

export const budgetAlerts = pgTable("budget_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  targetType: varchar("target_type", { length: 20 }).notNull(),
  targetId: uuid("target_id").notNull(),
  thresholdPct: integer("threshold_pct").notNull(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  month: date("month").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
